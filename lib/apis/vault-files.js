const {NotFoundError} = require('../const')
const dwebapi = require('@dpack/api')
const parseRange = require('range-parser')
const {identifyStream} = require('../helpers')
const directoryListingPage = require('../templates/directory-listing-page')
const joinPaths = require('path').join

// exported api
// =

module.exports = class VaultFilesAPI {
  constructor (dhost) {
    this.config = dhost.config
    this.usersDB = dhost.usersDB
    this.vaultsDB = dhost.vaultsDB
    this.vaultr = dhost.vaultr
  }

  async _getVaultRecord (req, {topLevel} = {}) {
    var username, archname, userRecord, vaultRecord
    const findFn = test => a => a.name.toLowerCase() === test

    if (this.config.sites === 'per-vault') {
      // vault.domain
      let archname = req.vhost[0]

      // lookup vault record
      vaultRecord = this.vaultsDB.getByName(archname)
      if (!vaultRecord) throw new NotFoundError()
      return vaultRecord
    } else {
      // user.domain/vault
      username = req.vhost[0]
      archname = req.path.split('/')[1]

      // lookup user record
      userRecord = await this.usersDB.getByUsername(username)
      if (!userRecord) throw new NotFoundError()

      if (!topLevel && archname) {
        // lookup vault record
        vaultRecord = userRecord.vaults.find(findFn(archname))
        if (vaultRecord) {
          vaultRecord.isNotToplevel = true
          return vaultRecord
        }
      }

      // look up vault record at username
      vaultRecord = userRecord.vaults.find(findFn(username))
      if (!vaultRecord) throw new NotFoundError()
      return vaultRecord
    }
  }

  async getDNSFile (req, res) {
    // get the vault record
    var vaultRecord = await this._getVaultRecord(req, {topLevel: true})

    // respond
    res.status(200).end('dweb://' + vaultRecord.key + '/\nTTL=3600')
  }

  async getFile (req, res) {
    var fileReadStream
    var headersSent = false
    var vaultRecord = await this._getVaultRecord(req)

    // skip the vaultname if the vault was not found by subdomain
    var reqPath = vaultRecord.isNotToplevel ? req.path.split('/').slice(2).join('/') : req.path

    // track whether the request has been aborted by client
    // if, after some async, we find `aborted == true`, then we just stop
    var aborted = false
    req.once('aborted', () => {
      aborted = true
    })

    // get the vault
    var vault = await this.vaultr.loadVault(vaultRecord.key)
    if (!vault) {
      throw NotFoundError()
    }
    if (aborted) return

    // read the manifest (it's needed in a couple places)
    var manifest
    try { manifest = await dwebapi.readManifest(vault) } catch (e) { manifest = null }

    // find an entry
    var filepath = decodeURIComponent(reqPath)
    if (!filepath) filepath = '/'
    var isFolder = filepath.endsWith('/')
    var entry
    const tryStat = async (path) => {
      if (entry) return
      // apply the web_root config
      if (manifest && manifest.web_root) {
        if (path) {
          path = joinPaths(manifest.web_root, path)
        } else {
          path = manifest.web_root
        }
      }

      // attempt lookup
      try {
        entry = await dwebapi.stat(vault, path)
        entry.path = path
      } catch (e) {}
    }
    // detect if this is a folder without a trailing slash
    if (!isFolder) {
      await tryStat(filepath)
      if (entry && entry.isDirectory()) {
        filepath = filepath + '/'
        isFolder = true
      }
    }
    entry = false
    // do actual lookup
    if (isFolder) {
      await tryStat(filepath + 'index.html')
      await tryStat(filepath)
    } else {
      await tryStat(filepath)
      await tryStat(filepath + '.html') // fallback to .html
    }
    if (aborted) return

    // handle folder
    if (entry && entry.isDirectory()) {
      var type = req.accepts(['json', 'text', 'html'])

      // If the client asked for text or didn't specify serve text
      if (type === 'text') {
        res.writeHead(200, 'OK', {
          'Content-Type': 'text/plain'
        })
        return res.end(await directoryListingPage.text(vault, filepath, manifest && manifest.web_root))
      }
      // If the client asked for html serve html.
      if (type === 'html') {
        res.writeHead(200, 'OK', {
          'Content-Type': 'text/html'
        })
        return res.end(await directoryListingPage.html(vault, filepath, manifest && manifest.web_root))
      }
      // If the client asked for json serve json.
      if (type === 'json') {
        res.writeHead(200, 'OK', {
          'Content-Type': 'application/json'
        })
        return res.end(await directoryListingPage.json(vault, filepath, manifest && manifest.web_root))
      }
      // We could not negotiate a type with the client
      res.writeHead(406, 'Not Acceptable', {
        'Content-Type': 'text/plain'
      })
      return res.end('Accept must be text/plain, text/html, or application/json\n')
    }

    // handle not found
    if (!entry) {
      // check for a fallback page
      if (manifest) {
        await tryStat(manifest.fallback_page)
      }
      if (!entry) {
        throw new NotFoundError()
      }
    }
    // add CORS per https://github.com/distributedweb/dhosting/issues/43
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')

    // handle range
    var statusCode = 200
    res.setHeader('Accept-Ranges', 'bytes')
    var range = req.headers.range && parseRange(entry.size, req.headers.range)
    if (range && range.type === 'bytes') {
      range = range[0] // only handle first range given
      statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + entry.size)
      res.setHeader('Content-Length', range.end - range.start + 1)
    } else {
      if (entry.size) {
        res.setHeader('Content-Length', entry.size)
      }
    }

    // caching if-match (not if range is used)
    const ETag = 'W/block-' + entry.offset
    if (statusCode === 200 && req.headers['if-none-match'] === ETag) {
      return res.status(304).end()
    }

    // fetch the entry and stream the response
    fileReadStream = vault.createReadStream(entry.path, range)
    fileReadStream
      .pipe(identifyStream(entry.path, mimeType => {
        // send headers, now that we can identify the data
        headersSent = true
        var headers = {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age: 60',
          ETag
        }
        res.writeHead(statusCode, 'OK', headers)
      }))
      .pipe(res)

    // handle empty files
    fileReadStream.once('end', () => {
      if (!headersSent) {
        // no content
        headersSent = true
        res.writeHead(200, 'OK')
        res.end('\n')
      }
    })

    // handle read-stream errors
    fileReadStream.once('error', _ => {
      if (!headersSent) {
        headersSent = true
        res.status(500).send('Failed to read file')
      }
    })

    // abort if the client aborts
    req.once('aborted', () => {
      if (fileReadStream) {
        fileReadStream.destroy()
      }
    })
  }
}
