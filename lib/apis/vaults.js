const figures = require('figures')
const bytes = require('bytes')
const sse = require('express-server-sent-events')
const throttle = require('lodash.throttle')
const {DPACK_KEY_REGEX, COHORT_STATE_ACTIVE, NotFoundError, UnauthorizedError, ForbiddenError} = require('../const')
const {wait} = require('../helpers')
const lock = require('../lock')

// exported api
// =

module.exports = class VaultsAPI {
  constructor (dhost) {
    this.activeProgressStreams = 0
    setInterval(() => console.log(figures.info, this.activeProgressStreams, 'active progress streams'), 60e3)

    this.config = dhost.config
    this.usersDB = dhost.usersDB
    this.vaultsDB = dhost.vaultsDB
    this.activityDB = dhost.activityDB
    this.vaultr = dhost.vaultr
  }

  async add (req, res) {
    // validate session
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('user')) throw new ForbiddenError()

    // validate & sanitize input
    req.checkBody('key').optional().isDWebHash()
    req.checkBody('url').optional().isDWebHashOrURL()
    req.checkBody('name').optional()
      .isDWebName().withMessage('Names must only contain characters, numbers, and dashes.')
      .isLength({ min: 1, max: 63 }).withMessage('Names must be 1-63 characters long.')
    ;(await req.getValidationResult()).throw()
    if (req.body.url) req.sanitizeBody('url').toDWebDomain()
    var { key, url, name } = req.body

    // only allow one or the other
    if ((!key && !url) || (key && url)) {
      return res.status(422).json({
        message: 'Must provide a key or url',
        invalidInputs: true
      })
    }
    if (url) {
      key = DPACK_KEY_REGEX.exec(url)[1]
    }

    var release = await Promise.all([lock('users'), lock('vaults')])
    try {
      // fetch user's record
      var userRecord = await this.usersDB.getByID(res.locals.session.id)

      // enforce names limit
      if (name) {
        let numNamedVaults = userRecord.vaults.filter(a => !!a.name).length
        let limit = userRecord.namedVaultQuota || this.config.defaultNamedVaultsLimit
        if (numNamedVaults >= limit) {
          return res.status(422).json({
            message: `You can only use ${limit} names. You must upload this vault without a name.`,
            outOfNamedVaults: true
          })
        }
      }

      // check that the user has the available quota
      if (this.config.getUserDiskQuotaPct(userRecord) >= 1) {
        return res.status(422).json({
          message: 'You have exceeded your disk usage',
          outOfSpace: true
        })
      }

      if (name) {
        let isAvailable = true

        // check that the name isnt reserved
        var {reservedNames} = this.config.registration
        if (reservedNames && Array.isArray(reservedNames) && reservedNames.length > 0) {
          if (reservedNames.indexOf(name.toLowerCase()) !== -1) {
            isAvailable = false
          }
        }

        // check that the name isnt taken
        let existingVault = await this.vaultsDB.getByName(name)
        if (existingVault && existingVault.key !== key) {
          isAvailable = false
        }

        if (!isAvailable) {
          return res.status(422).json({
            message: `${name} has already been taken. Please select a new name.`,
            details: {
              name: {
                msg: `${name} has already been taken. Please select a new name.`
              }
            }
          })
        }
      }

      // update the records
      // TEMPORARY we have to do addHostingUser first, and cancel if that fails -prf
      // await Promise.all([
      //   this.usersDB.addVault(userRecord.id, key, name),
      //   this.vaultsDB.addHostingUser(key, userRecord.id)
      // ])
      try {
        await this.vaultsDB.addHostingUser(key, userRecord.id, {
          name,
          ownerName: userRecord.username
        })
      } catch (e) {
        if (e.alreadyHosted) {
          return res.status(422).json({
            message: 'This vault is already being hosted by someone else'
          })
        }
        throw e // internal error
      }
      await this.usersDB.addVault(userRecord.id, key, name)
    } finally {
      release[0]()
      release[1]()
    }

    // record the event
    /* dont await */ req.logAnalytics('add-vault', {user: userRecord.id, key, name})
    /* dont await */ this.usersDB.updateCohort(userRecord, COHORT_STATE_ACTIVE)
    /* dont await */ this.activityDB.writeGlobalEvent({
      userid: userRecord.id,
      username: userRecord.username,
      action: 'add-vault',
      params: {key, name}
    })

    // add to the flock
    this.vaultr.loadVault(key).then(() => {
      this.vaultr._flockVault(key, {upload: true, download: true})
    })

    // respond
    res.status(200).end()
  }

  async remove (req, res) {
    // validate session
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('user')) throw new ForbiddenError()

    // validate & sanitize input
    req.checkBody('key').optional().isDWebHash()
    req.checkBody('url').optional().isDWebHashOrURL()
    ;(await req.getValidationResult()).throw()
    if (req.body.url) req.sanitizeBody('url').toDWebDomain()
    var { key, url } = req.body

    // only allow one or the other
    if ((!key && !url) || (key && url)) {
      return res.status(422).json({
        message: 'Must provide a key or url',
        invalidInputs: true
      })
    }
    if (url) {
      key = DPACK_KEY_REGEX.exec(url)[1]
    }

    var release = await Promise.all([lock('users'), lock('vaults')])
    try {
      // fetch the user
      var userRecord = await this.usersDB.getByID(res.locals.session.id)

      // find the vault name
      var vaultRecord = await this.vaultsDB.getExtraByKey(key)
      var name = vaultRecord.name

      // update the records
      await Promise.all([
        this.usersDB.removeVault(res.locals.session.id, key),
        this.vaultsDB.removeHostingUser(key, res.locals.session.id)
      ])
    } finally {
      release[0]()
      release[1]()
    }

    // record the event
    /* dont await */ req.logAnalytics('remove-vault', {user: userRecord.id, key, name})
    /* dont await */ this.activityDB.writeGlobalEvent({
      userid: userRecord.id,
      username: userRecord.username,
      action: 'del-vault',
      params: {key, name}
    })

    // remove from the flock
    var vault = await this.vaultsDB.getByKey(key)
    if (!vault.hostingUsers.length) {
      /* dont await */ this.vaultr.closeVault(key)
    }

    // respond
    res.status(200).end()
  }

  async list (req, res) {
    // we're getting user-specific information, so only handle this call if logged in
    if (!res.locals.sessionUser) {
      return res.status(200).json({items: []})
    }

    var items = await Promise.all(
      res.locals.sessionUser.vaults.map(a => (
        this._getVaultInfo(res.locals.sessionUser, a)
      ))
    )
    return res.status(200).json({items})
  }

  async get (req, res) {
    if (req.query.view === 'status') {
      return this.vaultStatus(req, res)
    }

    // we're getting user-specific information, so only handle this call if logged in
    if (!res.locals.sessionUser) throw new NotFoundError()

    // lookup vault
    var vault = res.locals.sessionUser.vaults.find(a => a.key === req.params.key)
    if (!vault) throw new NotFoundError()

    // give info about the vault
    var info = await this._getVaultInfo(res.locals.sessionUser, vault)
    return res.json(info)
  }

  async update (req, res) {
    // validate session
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('user')) throw new ForbiddenError()

    // validate & sanitize input
    req.checkBody('name').optional()
      .isDWebName().withMessage('Names must only contain characters, numbers, and dashes.')
      .isLength({ min: 1, max: 63 }).withMessage('Names must be 1-63 characters long.')
    ;(await req.getValidationResult()).throw()
    var key = req.params.key
    var { name } = req.body

    var release = await Promise.all([lock('users'), lock('vaults')])
    try {
      // fetch user's record
      var userRecord = await this.usersDB.getByID(res.locals.session.id)

      // find the vault
      var vaultRecord = userRecord.vaults.find(a => a.key === key)
      if (!vaultRecord) {
        throw new NotFoundError()
      }

      if (name) {
        let isAvailable = true

        // check that the name isnt reserved
        var {reservedNames} = this.config.registration
        if (reservedNames && Array.isArray(reservedNames) && reservedNames.length > 0) {
          if (reservedNames.indexOf(name.toLowerCase()) !== -1) {
            isAvailable = false
          }
        }

        // check that the name isnt taken
        let existingVault = await this.vaultsDB.getByName(name)
        if (existingVault && existingVault.key !== key) {
          isAvailable = false
        }

        if (!isAvailable) {
          return res.status(422).json({
            message: `${name} has already been taken. Please select a new name.`,
            details: {
              name: {
                msg: `${name} has already been taken. Please select a new name.`
              }
            }
          })
        }
      }

      // enforce names limit
      if (name && !vaultRecord.name /* only need to check if giving a name to an vault that didnt have one */) {
        let limit = userRecord.namedVaultQuota || this.config.defaultNamedVaultsLimit
        let numNamedVaults = userRecord.vaults.filter(a => !!a.name).length
        if (numNamedVaults >= limit) {
          return res.status(422).json({
            message: `You can only use ${limit} names. You must upload this vault without a name.`,
            outOfNamedVaults: true
          })
        }
      }

      // update the records
      vaultRecord.name = name
      await this.vaultsDB.addHostingUser(vaultRecord.key, userRecord.id, {
        name,
        ownerName: userRecord.username
      })
      await this.usersDB.put(userRecord)
    } finally {
      release[0]()
      release[1]()
    }

    // record the event
    /* dont await */ this.activityDB.writeGlobalEvent({
      userid: userRecord.id,
      username: userRecord.username,
      action: 'update-vault',
      params: {key, name}
    })

    // respond
    res.status(200).end()
  }

  async getByName (req, res) {
    // validate & sanitize input
    req.checkParams('username').isAlphanumeric().isLength({ min: 3, max: 16 })
    req.checkParams('vaultname').isDWebName().isLength({ min: 1, max: 64 })
    ;(await req.getValidationResult()).throw()
    var { username, vaultname } = req.params

    // lookup user
    var userRecord = await this.usersDB.getByUsername(username)
    if (!userRecord) throw new NotFoundError()

    // lookup vault
    const findFn = (DPACK_KEY_REGEX.test(vaultname))
      ? a => a.key === vaultname
      : a => a.name === vaultname
    var vault = userRecord.vaults.find(findFn)
    if (!vault) throw new NotFoundError()

    // lookup manifest
    var manifest = await this.vaultr.getManifest(vault.key)

    // respond
    res.status(200).json({
      user: username,
      key: vault.key,
      name: vault.name,
      title: manifest ? manifest.title : '',
      description: manifest ? manifest.description : ''
    })
  }

  async vaultStatus (req, res) {
    var type = req.accepts(['json', 'text/event-stream'])
    if (type === 'text/event-stream') {
      sse(req, res, () => this._getVaultProgressEventStream(req, res))
    } else {
      await this._getVault(req.params.key) // will throw if the vault is not active
      let progress = await this._getVaultProgress(req.params.key)
      res.status(200).json({ progress })
    }
  }

  async _getVault (key) {
    var vault = this.vaultr.getVault(key)
    if (!vault) {
      if (!this.vaultr.isLoadingVault(key)) {
        throw new NotFoundError()
      }
      vault = await this.vaultr.loadVault(key)
    }
    return vault
  }

  async _getVaultInfo (userRecord, vault) {
    // figure out additional urls
    var additionalUrls = []
    if (vault.name) {
      var niceUrl = `${vault.name}.${this.config.hostname}`
      additionalUrls = [`dweb://${niceUrl}`, `https://${niceUrl}`]
    }

    // load manifest data
    var title = ''
    var description = ''
    var manifest = await this.vaultr.getManifest(vault.key)
    if (manifest) {
      title = manifest.title || 'Untitled'
      description = manifest.description || ''
    }

    return {
      url: `dweb://${vault.key}`,
      name: vault.name,
      title,
      description,
      additionalUrls
    }
  }

  _getVaultProgressEventStream (req, res) {
    const evt = `progress:${req.params.key}`

    const onProgress = throttle(({progress, diskUsage}) => {
      progress = (progress * 100) | 0
      diskUsage = diskUsage ? bytes(diskUsage) : ''
      res.sse(`data: ${progress} ${diskUsage}\n\n`)
    }, 3e3, {leading: true, trailing: true})

    // send event
    onProgress({progress: this.vaultr.getDownloadProgress(req.params.key)})

    // register listener
    this.activeProgressStreams++
    this.vaultr.addListener(evt, onProgress)
    res.once('close', () => {
      this.activeProgressStreams--
      this.vaultr.removeListener(evt, onProgress)
    })
  }

  async _getVaultProgress (key) {
    var progress = await Promise.race([
      this.vaultr.getDownloadProgress(key),
      wait(5e3, false)
    ])
    return progress || 0
  }
}
