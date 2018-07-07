const {NotFoundError} = require('../const')
const nicedate = require('nicedate')
const bytes = require('bytes')

class UserContentAPI {
  constructor (dhost) {
    this.dhost = dhost
    this.config = dhost.config
  }

  async viewVault (req, res) {
    var {session} = res.locals

    // validate & sanitize input
    req.checkParams('username').isAlphanumeric().isLength({ min: 3, max: 16 })
    req.checkParams('vaultname').isDWebName().isLength({ min: 1, max: 64 })
    ;(await req.getValidationResult()).throw()
    var {username, vaultname} = req.params

    // lookup user
    var userRecord = await this.dhost.usersDB.getByUsername(username)
    if (!userRecord) throw new NotFoundError()

    // lookup vault
    var userVaultRecord = userRecord.vaults.find(a => a.name === vaultname || a.key === vaultname)
    if (!userVaultRecord) throw new NotFoundError()
    var isOwner = session && session.id === userRecord.id
    vaultname = userVaultRecord.name || ''

    // figure out url
    var niceUrl = `${vaultname}.${this.config.hostname}`

    // load progress
    var progress
    if (isOwner) {
      progress = await this.dhost.vaultr.getDownloadProgress(userVaultRecord.key)
    }

    // load manifest data
    var title = ''
    var description = ''
    var manifest = await this.dhost.vaultr.getManifest(userVaultRecord.key)
    if (manifest) {
      title = manifest.title || 'Untitled'
      description = manifest.description || ''
    }

    // load additional data
    var vault = this.dhost.vaultr.getVault(userVaultRecord.key)
    var isFeatured = await this.dhost.featuredVaultsDB.has(userVaultRecord.key)

    res.render('vault', {
      username,
      key: userVaultRecord.key,
      vaultname,
      title,
      description,
      isFeatured,
      niceUrl,
      rawUrl: `dweb://${userVaultRecord.key}/`,
      progress: (progress * 100) | 0,
      diskUsage: bytes(vault ? vault.diskUsage : 0),
      isOwner,
      csrfToken: req.csrfToken()
    })
  }

  async viewUser (req, res) {
    // validate & sanitize input
    req.checkParams('username').isAlphanumeric().isLength({ min: 3, max: 16 })
    ;(await req.getValidationResult()).throw()
    var {username} = req.params

    // lookup user
    var userRecord = await this.dhost.usersDB.getByUsername(username)
    if (!userRecord) throw new NotFoundError()

    // lookup user's activity
    var activity = await this.dhost.activityDB.listUserEvents(username, {
      limit: 25,
      lt: req.query.start,
      reverse: true
    })

    // fetch more vault data
    var vaults = await Promise.all(userRecord.vaults.map(async (vault) => {
      vault = await this.dhost.vaultsDB.getExtraByKey(vault.key)
      vault.diskUsage = bytes(vault.diskUsage || 0)
      return vault
    }))

    res.render('user', {
      userRecord,
      vaults,
      activity,
      nicedate,
      activityLimit: 25,
      csrfToken: req.csrfToken()
    })
  }
}

module.exports = UserContentAPI
