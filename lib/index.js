const level = require('level')
const assert = require('assert')
const path = require('path')
const fs = require('fs')
const wrap = require('co-express')
const dHostingAnalytics = require('@dbrowser/internal-tracker')
const {debounceConsole} = require('@dhosting/logger')
const {hashPassword} = require('./crypto')
const figures = require('figures')
const Sessions = require('./sessions')
const Mailer = require('./mailer')
const lock = require('./lock')
const Vaultr = require('./vaultr')
const UsersAPI = require('./apis/users')
const VaultsAPI = require('./apis/vaults')
const VaultFilesAPI = require('./apis/vault-files')
const ReportsAPI = require('./apis/reports')
const ServiceAPI = require('./apis/service')
const UserContentAPI = require('./apis/user-content')
const PagesAPI = require('./apis/pages')
const AdminAPI = require('./apis/admin')
const Shemas = require('./dbs/schemas')
const UsersDB = require('./dbs/users')
const VaultsDB = require('./dbs/vaults')
const ActivityDB = require('./dbs/activity')
const ReportsDB = require('./dbs/reports')
const FeaturedVaultsDB = require('./dbs/featured-vaults')
const { isPassword } = require('../lib/validators')

class DistributedHosting {
  constructor (config) {
    assert(config, 'dHosting requires options')
    assert(config.hostname, 'config.hostname is required')
    assert(config.dir || config.db, 'dHosting requires a dir or db option')

    // fallback config
    config.env = config.env || 'development'

    // setup config
    var {dir, db} = config
    if (dir) {
      // ensure the target dir exists
      console.log(figures.info, 'Data directory:', dir)
      try {
        fs.accessSync(dir, fs.F_OK)
      } catch (e) {
        fs.mkdirSync(dir)
      }
    }
    if (!db && dir) {
      // allocate a leveldb
      db = level(path.join(dir, 'db'), { valueEncoding: 'json' })
    }
    assert(db, 'database was not created')
    this.config = config
    this.db = db

    // state guards
    var adminCreatedPromise = new Promise(resolve => {
      this._adminCreated = resolve
    })
    this.whenAdminCreated = adminCreatedPromise.then.bind(adminCreatedPromise)

    // init components
    this.lock = lock
    this.analytics = new dHostingAnalytics({
      db: path.join(dir, 'analytics.db'),
      domain: config.hostname
    })
    // this.proofs = new Proofs(config) TODO
    this.mailer = new Mailer(config)
    this.vaultr = new Vaultr(this)
    this.usersDB = new UsersDB(this)
    this.vaultsDB = new VaultsDB(this)
    this.activityDB = new ActivityDB(this)
    this.featuredVaultsDB = new FeaturedVaultsDB(this)
    this.reportsDB = new ReportsDB(this)
    this.sessions = new Sessions(this)

    // init apis
    this.api = {
      users: new UsersAPI(this),
      vaults: new VaultsAPI(this),
      vaultFiles: new VaultFilesAPI(this),
      service: new ServiceAPI(this),
      userContent: new UserContentAPI(this),
      pages: new PagesAPI(this),
      admin: new AdminAPI(this),
      reports: new ReportsAPI(this)
    }

    // wrap all APIs in co-express handling
    wrapAll(this.api.users)
    wrapAll(this.api.vaults)
    wrapAll(this.api.vaultFiles)
    wrapAll(this.api.service)
    wrapAll(this.api.userContent)
    wrapAll(this.api.pages)
    wrapAll(this.api.admin)
    wrapAll(this.api.reports)
  }

  async setupDatabase () {
    // run db migrations
    var schemas = new Shemas(this)
    await schemas.migrate()
  }

  async loadAllVaults () {
    // load all vaults
    var ps = []
    this.vaultsDB.vaultsDB.createKeyStream().on('data', key => {
      ps.push(this.vaultr.loadVault(key).then(null, _ => null))
      debounceConsole.log(`${figures.pointerSmall} Loading vault`, {timeout: 500, max: 1e3})
    }).on('end', async () => {
      await Promise.all(ps)
      console.log(figures.tick, 'All vaults loaded,', ps.length, 'total')
      // compute user disk usage and flock vaults accordingly
      this.vaultr.computeAllUserDiskUsageAndFlock()
      // create the popular-vaults index
      this.vaultr.computePopularIndex()
    })
  }

  async setupAdminUser () {
    try {
      // is the admin-user config wellformed?
      var adminConfig = this.config.admin
      if (!adminConfig || !adminConfig.password) {
        console.log('Admin user not created: must set password in config')
        return this._adminCreated(false) // abort if not
      }
      if (!isPassword(adminConfig.password)) {
        console.log('Admin user not created: invalid password')
        return this._adminCreated(false)
      }

      // upsert the admin user with these creds
      var method = 'put'
      let {passwordHash, passwordSalt} = await hashPassword(adminConfig.password)
      var adminRecord = await this.usersDB.getByUsername('admin')
      if (!adminRecord) {
        method = 'create'
        adminRecord = {
          username: 'admin',
          scopes: ['user', 'admin:dwebs', 'admin:users'],
          isEmailVerified: true
        }
      }
      adminRecord.passwordHash = passwordHash
      adminRecord.passwordSalt = passwordSalt
      if (adminConfig.email) adminRecord.email = adminConfig.email
      await this.usersDB[method](adminRecord)
      console.log(figures.tick, (method === 'create' ? 'Created' : 'Updated'), 'admin record')
      this._adminCreated(true)
    } catch (e) {
      console.error('[ERROR] While trying to create admin user:', e)
      this._adminCreated(false)
    }
  }

  async close (cb) {
    await this.vaultr.closeAllVaults()
    cb()
  }
}

module.exports = DistributedHosting

function wrapAll (api) {
  for (let methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(api))) {
    let method = api[methodName]
    if (typeof method === 'function' && methodName.charAt(0) !== '_') {
      api[methodName] = wrap(method.bind(api))
    }
  }
}
