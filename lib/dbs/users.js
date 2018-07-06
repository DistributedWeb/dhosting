var assert = require('assert')
var monotonicTimestamp = require('monotonic-timestamp')
var levelPromise = require('level-promise')
var createIndexer = require('level-simple-indexes')
var sublevel = require('subleveldown')
var collect = require('@dwcore/dwsc')
var EventEmitter = require('events')
var moment = require('moment')
var { promisifyModule } = require('../helpers')
var lock = require('../lock')
const {
  COHORT_STATE_REGISTERED,
  COHORT_STATE_ACTIVATED,
  COHORT_STATE_ACTIVE
} = require('../const')

// exported api
// =

class UsersDB extends EventEmitter {
  constructor (dhost) {
    super()
    // create levels and indexer
    this.dhost = dhost
    this.accountsDB = sublevel(dhost.db, 'accounts', { valueEncoding: 'json' })
    this.indexDB = sublevel(dhost.db, 'accounts-index')
    this.indexer = createIndexer(this.indexDB, {
      keyName: 'id',
      properties: ['email', 'username', 'profileURL'],
      map: (id, next) => {
        this.getByID(id)
          .catch(next)
          .then(res => next(null, res))
      }
    })

    // promisify
    levelPromise.install(this.accountsDB)
    levelPromise.install(this.indexDB)
    promisifyModule(this.indexer, ['findOne', 'addIndexes', 'removeIndexes', 'updateIndexes'])
  }

  // basic ops
  // =

  async create (record) {
    assert(record && typeof record === 'object')
    record = Object.assign({}, UsersDB.defaults(), record)
    record.id = monotonicTimestamp().toString(36)
    record.createdAt = Date.now()
    await this.put(record)
    this.emit('create', record)
    return record
  }

  async put (record) {
    assert(typeof record.id === 'string')
    var release = await lock('users:write:' + record.id)
    try {
      record.updatedAt = Date.now()
      await this.accountsDB.put(record.id, record)
      await this.indexer.updateIndexes(record)
    } finally {
      release()
    }
    this.emit('put', record)
  }

  // update() is a put() that uses locks
  // - use this when outside of a locking transaction
  async update (id, updates) {
    assert(typeof id === 'string')
    assert(updates && typeof updates === 'object')
    var release = await lock('users')
    try {
      var record = await this.getByID(id)
      for (var k in updates) {
        if (k === 'id' || typeof updates[k] === 'undefined') {
          continue // dont allow that!
        }
        record[k] = updates[k]
      }
      record.updatedAt = Date.now()
      await this.accountsDB.put(record.id, record)
      await this.indexer.updateIndexes(record)
    } finally {
      release()
    }
    this.emit('put', record)
    return record
  }

  async del (record) {
    assert(typeof record.id === 'string')
    var release = await lock('users:write:' + record.id)
    try {
      await this.accountsDB.del(record.id)
      await this.indexer.removeIndexes(record)
    } finally {
      release()
    }
    this.emit('del', record)
  }

  // getters
  // =
  // TODO
  // do these getters need to be put behind locks along w/the rights?
  // the index-based reads (email, username) involve 2 separate reads, not atomic
  // -prf

  async isEmailTaken (email) {
    var record = await this.getByEmail(email)
    return !!record
  }

  async isUsernameTaken (username) {
    var record = await this.getByUsername(username)
    return !!record
  }

  async getByID (id) {
    assert(typeof id === 'string')
    try {
      return await this.accountsDB.get(id)
    } catch (e) {
      if (e.notFound) return null
      throw e
    }
  }

  async getByEmail (email) {
    assert(typeof email === 'string')
    return this.indexer.findOne('email', email)
  }

  async getByUsername (username) {
    assert(typeof username === 'string')
    return this.indexer.findOne('username', username)
  }

  async getByProfileURL (profileURL) {
    assert(typeof profileURL === 'string')
    return this.indexer.findOne('profileURL', profileURL)
  }

  list ({cursor, limit, reverse, sort} = {}) {
    return new Promise((resolve, reject) => {
      var opts = {limit, reverse}
      // find indexes require a start- and end-point
      if (sort && sort !== 'id') {
        if (reverse) {
          opts.lt = cursor || '\xff'
          opts.gte = '\x00'
        } else {
          opts.gt = cursor || '\x00'
          opts.lte = '\xff'
        }
      } else if (typeof cursor !== 'undefined') {
        // set cursor according to reverse
        if (reverse) opts.lt = cursor
        else opts.gt = cursor
      }
      // fetch according to sort
      var stream
      if (sort === 'username') stream = this.indexer.find('username', opts)
      else if (sort === 'email') stream = this.indexer.find('email', opts)
      else stream = this.accountsDB.createValueStream(opts)
      // collect into an array
      collect(stream, (err, res) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }

  createValueStream (opts) {
    return this.accountsDB.createValueStream(opts)
  }

  // highlevel updates
  // =

  async addVault (userId, vaultKey, name) {
    var release = await lock('users:update:' + userId)
    try {
      // fetch/create record
      var userRecord = await this.getByID(userId)

      // add/update vault
      var vaultRecord = userRecord.vaults.find(a => a.key === vaultKey)
      if (!vaultRecord) {
        vaultRecord = Object.assign({}, UsersDB.vaultDefaults())
        vaultRecord.key = vaultKey
        if (typeof name !== 'undefined') vaultRecord.name = name
        userRecord.vaults.push(vaultRecord)
      } else {
        if (typeof name !== 'undefined') vaultRecord.name = name
      }

      // update disk usage
      var vault = this.dhost.vaultr.getVault(vaultKey)
      if (vault && vault.diskUsage) {
        userRecord.diskUsage += vault.diskUsage
      }

      // update records
      await this.put(userRecord)
    } finally {
      release()
    }
    this.emit('add-vault', {userId, vaultKey, name}, userRecord)
  }

  async removeVault (userId, vaultKey) {
    var release = await lock('users:update:' + userId)
    try {
      // fetch/create record
      var userRecord = await this.getByID(userId)

      // remove vault
      var index = userRecord.vaults.findIndex(a => a.key === vaultKey)
      if (index === -1) {
        return // not already hosting
      }
      userRecord.vaults.splice(index, 1)

      // update disk usage
      var vault = this.dhost.vaultr.getVault(vaultKey)
      if (vault && vault.diskUsage) {
        userRecord.diskUsage -= vault.diskUsage
        /* dont await */ this.dhost.vaultr.computeUserDiskUsageAndFlock(userRecord)
      }

      // update records
      await this.put(userRecord)
    } finally {
      release()
    }
    this.emit('remove-vault', {userId, vaultKey}, userRecord)
  }

  // analytics
  // =

  getUserCohort (user) {
    assert(user && typeof user === 'object')
    assert(user.createdAt)
    var d = moment(user.createdAt)
    return d.format('YYYYWW')
  }

  async updateCohort (user, state) {
    return this.dhost.analytics.updateCohort('active_users', {
      subject: user.id,
      cohort: this.getUserCohort(user),
      state
    })
  }

  async computeCohorts () {
    var now = Date.now()
    var twoWeeks = moment.duration(2, 'weeks')
    var promises = []

    const compute = async (record) => {
      var state = COHORT_STATE_REGISTERED

      // active?
      if (record.vaults.length) {
        state = COHORT_STATE_ACTIVATED

        // active in the last 2 weeks?
        for (var i = 0; i < record.vaults.length; i++) {
          var mtime = await this.dhost.vaultr.getVaultMtime(record.vaults[i].key)
          if (mtime && (now - mtime) <= twoWeeks) {
            state = COHORT_STATE_ACTIVE
            break
          }
        }
      }

      // update
      await this.updateCohort(record, state)
    }

    // stream all records
    var s = this.accountsDB.createValueStream()
    s.on('data', record => promises.push(compute(record)))
    return new Promise((resolve, reject) => {
      s.on('end', () => Promise.all(promises).then(resolve, reject))
    })
  }
}
module.exports = UsersDB

// default user-record values
UsersDB.defaults = () => ({
  username: null,
  passwordHash: null,
  passwordSalt: null,

  email: null,
  profileURL: null,
  scopes: [],
  suspension: null,
  vaults: [],
  updatedAt: 0,
  createdAt: 0,

  plan: 'basic',
  diskUsage: 0,

  diskQuota: null,
  namedVaultQuota: undefined,

  isEmailVerified: false,
  emailVerifyNonce: null,

  forgotPasswordNonce: null,

  isProfileDatVerified: false,
  profileVerifyToken: null,

  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripeTokenId: null,
  stripeCardId: null,
  stripeCardBrand: null,
  stripeCardCountry: null,
  stripeCardCVCCheck: null,
  stripeCardExpMonth: null,
  stripeCardExpYear: null,
  stripeCardLast4: null
})

// default user-record vault values
UsersDB.vaultDefaults = () => ({
  key: null,
  name: null
})
