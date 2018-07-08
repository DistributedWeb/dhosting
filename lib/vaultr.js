const EventEmitter = require('events')
const crypto = require('crypto')
const path = require('path')
const promisify = require('es6-promisify')
const ddrive = require('@ddrive/core')
const ddatabaseProtocol = require('@ddatabase/protocol')
const dwebCodec = require('@dwebs/codec')
const revelationServer = require('@flockcore/server')
const flockDefaults = require('@flockcore/presets')
const ms = require('ms')
const bytes = require('bytes')
const throttle = require('lodash.throttle')
const pump = require('pump')
const lock = require('./lock')
const {du, dpackStat, dpackReadFile, dpackIterateFiles, isObject} = require('./helpers')
const debug = require('debug')('vaultr')
const figures = require('figures')
const {summaryConsole, debounceConsole} = require('@dhosting/logger')

const stat = promisify(require('fs').stat)
const mkdirp = promisify(require('mkdirp'))
const rimraf = promisify(require('rimraf'))

// exported api
// =

module.exports = class Vaultr extends EventEmitter {
  constructor (dhost) {
    super()
    this.dhost = dhost
    this.config = dhost.config
    this.vaults = {}
    this.vaultsByDKey = {}
    this.loadPromises = {}
    this.flock = null
    this.networkId = crypto.randomBytes(32)
    this._connIdCounter = 0 // for debugging

    // initiate the flock
    this._initializeFlock()

    // periodically construct the indexes
    this.indexes = {popular: []}
    this._startJob(this.computePopularIndex, 'popularVaultsIndex')
    this._startJob(this.computeAllUserDiskUsageAndFlock, 'userDiskUsage')
    this._startJob(this.deleteDeadVaults, 'deleteDeadVaults')
  }

  // methods
  // =

  getVault (key) {
    return this.vaults[key]
  }

  isLoadingVault (key) {
    return key in this.loadPromises
  }

  async getVaultDiskUsage (key, {forceUpdate, dontUpdateUser} = {}) {
    key = dwebCodec.toStr(key)
    var vault = this.getVault(key)
    if (!vault) return 0
    if (!vault.diskUsage && !forceUpdate) {
      // pull from DB
      let vaultRecord = await this.dhost.vaultsDB.getByKey(key)
      vault.diskUsage = vaultRecord.diskUsage
    }
    if (!vault.diskUsage || forceUpdate) {
      // read size on disk
      console.log(figures.info, 'Calculating vault disk usage', key)
      let oldUsage = vault.diskUsage || 0
      let path = this._getVaultFilesPath(key)
      vault.diskUsage = await du(path)

      // cache to the db
      let vaultRecord = await this.dhost.vaultsDB.update(key, {diskUsage: vault.diskUsage})

      // if different, update the user record as well
      if (!dontUpdateUser && oldUsage !== vault.diskUsage) {
        vaultRecord.hostingUsers.forEach(async id => {
          let userRecord = await this.dhost.usersDB.getByID(id)
          this.computeUserDiskUsageAndFlock(userRecord)
        })
      }
    }
    return vault.diskUsage
  }

  // load vault (wrapper) manages load promises
  async loadVault (key) {
    key = dwebCodec.toStr(key)

    // fallback to vault if it exists
    if (key in this.vaults) {
      return this.vaults[key]
    }

    // fallback to the promise, if it exists
    if (key in this.loadPromises) {
      return this.loadPromises[key]
    }

    // ensure the folder exists
    var vaultPath = this._getVaultFilesPath(key)
    await mkdirp(vaultPath)

    // run and cache the promise
    var p = this._loadVaultInner(vaultPath, key)
    this.loadPromises[key] = p

    // when done, clear the promise
    const clear = () => delete this.loadPromises[key]
    p.then(clear, clear)

    // when done, save the vault instance
    p.then(vault => {
      this.vaults[key] = vault
      this.vaultsByDKey[dwebCodec.toStr(vault.revelationKey)] = vault
    })

    return p
  }

  async closeVault (key) {
    key = dwebCodec.toStr(key)
    var vault = this.vaults[key]
    if (vault) {
      this._flockVault(vault, {download: false, upload: false})
      await new Promise(resolve => vault.close(resolve))
      delete this.vaults[key]
      delete this.vaultsByDKey[dwebCodec.toStr(vault.revelationKey)]
    } else {
      // is vault still loading?
      // wait to finish then try to close
      if (this.isLoadingVault(key)) {
        await this.loadPromises[key]
        return this.closeVault(key)
      }
    }
  }

  async closeAllVaults () {
    return Promise.all(Object.keys(this.vaults).map(key =>
      this.closeVault(key)
    ))
  }

  // helper only reads manifest from disk if DNE or changed
  async getManifest (key) {
    var keyStr = dwebCodec.toStr(key)
    var vault = this.vaults[keyStr]
    if (!vault) {
      return null
    }
    try {
      var st = await dpackStat(vault, '/dpack.json', {cached: true})
      if (vault.manifest) {
        if (st.offset === vault.manifest._offset) {
          // use cached
          return vault.manifest
        }
      }
      if (st.size > bytes('1mb')) throw new Error('Manifest file is too large')
      vault.manifest = JSON.parse(await dpackReadFile(vault, '/dpack.json', {cached: true}))
      if (!isObject(vault.manifest)) throw new Error('Not an object')
      vault.manifest._offset = st.offset
      return vault.manifest
    } catch (e) {
      if (!e.notFound) {
        summaryConsole.error('Failed to load manifest for', dwebCodec.toStr(vault.key), e)
      }
      return vault.manifest || null // use cached when possible
    }
  }

  async getVaultMtime (key) {
    let path = this._getVaultFilesPath(key)
    try {
      var st = await stat(path)
      return st.mtime
    } catch (e) {
      return 0
    }
  }

  getDownloadProgress (key) {
    key = dwebCodec.toStr(key)
    var vault = this.vaults[key]
    if (!vault || vault.latestStats.numBlocks === 0) {
      return 0
    }
    return Math.min(vault.latestStats.numDownloadedBlocks / vault.latestStats.numBlocks, 1)
  }

  isVaultFullyDownloaded (key) {
    key = dwebCodec.toStr(key)
    var vault = this.vaults[key]
    if (!vault || vault.latestStats.numBlocks === 0) {
      return false
    }
    return vault.latestStats.numDownloadedBlocks === vault.latestStats.numBlocks
  }

  async computePopularIndex () {
    var release = await lock('vaultr-job')
    try {
      console.log(figures.pointerSmall, 'START Compute popular vaults index')
      var start = Date.now()
      var popular = Object.keys(this.vaults)
      popular.sort((aKey, bKey) => (
        this.vaults[bKey].numPeers - this.vaults[aKey].numPeers
      ))
      this.indexes.popular = popular.slice(0, 100).map(key => (
        {key, numPeers: this.vaults[key].numPeers}
      ))
    } catch (e) {
      console.error(e)
      console.log(figures.warning, `FAILED Compute popular vaults index (${(Date.now() - start)}ms)`)
    } finally {
      console.log(figures.tick, `FINISH Compute popular vaults index (${(Date.now() - start)}ms)`)
      release()
    }
  }

  async computeUserDiskUsageAndFlock (userRecord) {
    // sum the disk usage of each vault
    var diskUsage = 0
    await Promise.all(userRecord.vaults.map(async (vaultRecord) => {
      let u = await this.getVaultDiskUsage(vaultRecord.key, {dontUpdateUser: true})
      diskUsage += u
    }))

    // store on the user record
    userRecord.diskUsage = diskUsage
    await this.dhost.usersDB.update(userRecord.id, {diskUsage})

    // reconfigure flocks based on quota overages
    var quotaPct = this.config.getUserDiskQuotaPct(userRecord)
    userRecord.vaults.forEach(vaultRecord => {
      this._flockVault(vaultRecord.key, {
        upload: true, // always upload
        download: quotaPct < 1 // only download if the user has capacity
      })
    })
  }

  async computeAllUserDiskUsageAndFlock () {
    var release = await lock('vaultr-job')
    try {
      console.log(figures.pointerSmall, 'START Compute user quota usage')
      var start = Date.now()
      var users = await this.dhost.usersDB.list()
      await Promise.all(users.map(this.computeUserDiskUsageAndFlock.bind(this)))
    } catch (e) {
      console.error(e)
      console.log(figures.warning, `FAILED Compute user quota usage (${(Date.now() - start)}ms)`)
    } finally {
      console.log(figures.tick, `FINISH Compute user quota usage (${(Date.now() - start)}ms)`)
      release()
    }
  }

  async deleteDeadVaults () {
    var release = await lock('vaultr-job')
    try {
      console.log(figures.pointerSmall, 'START Delete dead vaults')
      var start = Date.now()
      var deadVaultKeys = await this.dhost.vaultsDB.listDeadVaultKeys()
      await Promise.all(deadVaultKeys.map(async (vaultKey) => {
        // make sure the vault is closed
        this.closeVault(vaultKey)
        // delete files
        console.log(figures.info, 'Deleting', vaultKey)
        var vaultPath = this._getVaultFilesPath(vaultKey)
        await rimraf(vaultPath, {disableGlob: true})
        // delete DB record
        await this.dhost.vaultsDB.del(vaultKey)
      }))
    } catch (e) {
      console.error(e)
      console.log(figures.warning, `FAILED Delete dead vaults (${(Date.now() - start)}ms)`)
    } finally {
      console.log(figures.tick, `FINISH Delete dead vaults (${(Date.now() - start)}ms)`)
      release()
    }
  }

  // internal
  // =

  _getVaultFilesPath (key) {
    return path.join(this.config.dir, 'vaults', key.slice(0, 2), key.slice(2))
  }

  _startJob (method, configKey) {
    var i = setInterval(method.bind(this), ms(this.config.jobs[configKey]))
    i.unref()
  }

  // load vault (inner) main load logic
  async _loadVaultInner (vaultPath, key) {
    // create the vault instance
    var vault = ddrive(vaultPath, key, {
      sparse: false,
      metadataStorageCacheSize: this.config.cache.metadataStorage,
      contentStorageCacheSize: this.config.cache.contentStorage,
      treeCacheSize: this.config.cache.tree
    })
    vault.isFlocking = false
    vault.replicationStreams = [] // list of all active replication streams
    Object.defineProperty(vault, 'numPeers', {get: () => vault.metadata.peers.length + 1})
    vault.manifest = null // cached manifest
    vault.diskUsage = 0 // cached disk usage
    vault.latestStats = {
      // calculated by _computeVaultLatestStats:
      numDownloadedBlocks: 0, // # of blocks downloaded of the latest version
      numBlocks: 0, // # of blocks in the latest version
      numBytes: 0, // # of bytes in the latest version
      numFiles: 0 // # of files in the latest version
    }
    vault.recomputeMetadata = throttle(() => {
      this._computeVaultLatestStats(vault)
      this.getVaultDiskUsage(vault.key, {forceUpdate: true})
    }, ms('5s'), {leading: true, trailing: true})

    // wait for ready
    await new Promise((resolve, reject) => {
      vault.ready(err => {
        if (err) reject(err)
        else resolve()
      })
    })

    // read cached data from DB from DB
    this.dhost.vaultsDB.getByKey(dwebCodec.toStr(key)).then(record => {
      const st = vault.latestStats
      for (let k in st) {
        st[k] = (typeof record[k] === 'number') ? record[k] : st[k]
      }
      if (!st.numBlocks) {
        // need to compute, wasn't cached in the DB
        if (vault.content) this._computeVaultLatestStats(vault)
        else vault.once('content', () => this._computeVaultLatestStats(vault))
      }
    })

    // wire up handlers
    vault.metadata.on('download', vault.recomputeMetadata)
    const onContentReady = () => {
      vault.content.on('download', vault.recomputeMetadata)
    }
    if (vault.content) onContentReady()
    else vault.once('content', onContentReady)

    return vault
  }

  // flock vault
  _flockVault (vault, opts) {
    if (typeof vault === 'string') {
      vault = this.getVault(vault)
      if (!vault) return
    }

    // are any opts changed?
    var so = vault.flockOpts
    if (so && so.download === opts.download && so.upload === opts.upload) {
      return
    }

    // close existing flock
    var wasFlocking = vault.isFlocking
    if (vault.isFlocking) {
      vault.replicationStreams.forEach(stream => stream.destroy()) // stop all active replications
      vault.replicationStreams.length = 0
      vault.isFlocking = false
      this.flock.leave(vault.revelationKey)
    }

    // done?
    if (opts.download === false && opts.upload === false) {
      if (wasFlocking) {
        console.log(figures.info, 'Unflocking vault', dwebCodec.toStr(vault.key))
      }
      return
    }

    // join the flock
    debounceConsole.log(`${figures.info} Flocking vault`, {timeout: 250, max: 1e3}, dwebCodec.toStr(vault.key))
    vault.isFlocking = true
    vault.flockOpts = opts
    this.flock.listen(vault.revelationKey, 0, () => {})
  }

  async _computeVaultLatestStats (vault) {
    var start = Date.now()
    var release = await lock('vaultr-compute-stats')
    const vaultKey = dwebCodec.toStr(vault.key)
    const {metadata, content} = vault
    try {
      if (!metadata || !content) {
        // sanity check
        console.error('Had to abort computing vault stats', {vaultKey, metadata: !!metadata, content: !!content})
        return
      }

      // checkout the vault for consistency
      var co = vault.checkout(vault.version)

      // reset all stats
      const st = vault.latestStats
      for (var k in st) {
        st[k] = 0
      }

      // get stats on all files and update stats
      await dpackIterateFiles(co, '/', (fileSt) => {
        st.numDownloadedBlocks += countDownloadedBlocks(fileSt.offset, fileSt.blocks)
        st.numBlocks += fileSt.blocks
        st.numBytes += fileSt.size
        st.numFiles++
      })

      // update DB
      await this.dhost.vaultsDB.update(vaultKey, st)

      // emit
      // - will trigger progress SSEs to push
      this.emit('progress:' + vaultKey, {
        progress: Math.min(st.numDownloadedBlocks / st.numBlocks, 1),
        diskUsage: vault.diskUsage
      })
      console.log(figures.pointerSmall, `Computed vault stats (${Date.now() - start}ms)`, vaultKey)
    } catch (err) {
      console.error('ERROR while computing vault stats', err)
    } finally {
      release()
    }

    function countDownloadedBlocks (offset, len) {
      var n = 0
      for (var i = 0; i < len; i++) {
        if (content.has(offset + i)) n++
      }
      return n
    }
  }

  _initializeFlock () {
    console.log(figures.pointerSmall, 'Initializing dWeb flock')
    this.flock = revelationServer(flockDefaults({
      hash: false,
      utp: true,
      tcp: true,
      dht: false
    }))
    this.flock.on('error', err => console.error('Flock error', err))
    this.flock.on('listening', () => console.log(figures.tick, 'Flock listening'))
    this.flock.on('connection', (connection, info) => {
      info.host = connection.address().address
      info.port = connection.address().port
      const replicationStream = this._createReplicationStream(info)
      pump(connection, replicationStream, connection)
    })
  }

  _createReplicationStream (info) {
    this.emit('new-connection', info)

    // create the protocol stream
    var connId = ++this._connIdCounter
    var start = Date.now()
    var stream = ddatabaseProtocol({
      id: this.networkId,
      live: true,
      encrypt: true
    })
    stream.isActivePeer = false
    stream.peerInfo = info

    const add = (dkey) => {
      // lookup the vault
      var dkeyStr = dwebCodec.toStr(dkey)
      var chan = dkeyStr.slice(0, 6) + '..' + dkeyStr.slice(-2)
      var vault = this.vaultsByDKey[dkeyStr]
      if (!vault) {
        return
      }

      // ditch if we already have this stream
      if (vault.replicationStreams.indexOf(stream) !== -1) {
        return
      }

      // do some logging
      var keyStr = dwebCodec.toStr(vault.key)
      var keyStrShort = keyStr.slice(0, 6) + '..' + keyStr.slice(-2)
      debug(`new connection id=${connId} key=${keyStrShort} dkey=${chan} type=${info.type} host=${info.host}:${info.port}`)

      // create the replication stream
      var so = vault.flockOpts
      if (!so) {
        // DEBUG
        // this should NOT be happening and I'm not sure why it is
        // so let's just create a temporary flockOpts and log
        if (this.config.pm2) {
          require('pmx').emit('debug:flockopts-missing', {
            key: keyStr,
            isLoading: this.isLoadingVault(keyStr),
            isFlocking: vault.isFlocking,
            numStreams: vault.replicationStreams.length
          })
        }
        so = {download: true, upload: true}
      }
      vault.replicate({
        stream,
        download: so.download,
        upload: so.upload,
        live: true
      })
      vault.replicationStreams.push(stream)
      stream.once('close', () => {
        var rs = vault.replicationStreams
        var i = rs.indexOf(stream)
        if (i !== -1) rs.splice(rs.indexOf(stream), 1)
      })
    }

    // add any requested vaults
    stream.on('feed', add)

    // debugging (mostly)
    var connectionError
    stream.once('handshake', () => {
      stream.isActivePeer = true
      debug(`got handshake (${Date.now() - start}ms) id=${connId} type=${info.type} host=${info.host}:${info.port}`)
    })
    stream.on('error', err => {
      connectionError = err
      this.emit('connection-errored', info, err)
      debug(`error (${Date.now() - start}ms) id=${connId} type=${info.type} host=${info.host}:${info.port} error=${err.toString()}`)
    })
    stream.on('close', () => {
      this.emit('connection-closed', info, connectionError)
      debug(`closing connection (${Date.now() - start}ms) id=${connId} type=${info.type} host=${info.host}:${info.port}`)
    })
    return stream
  }
}
