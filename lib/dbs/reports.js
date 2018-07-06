var createIndexer = require('level-simple-indexes')
var levelPromise = require('level-promise')
var EventEmitter = require('events')
var assert = require('assert')
var sublevel = require('subleveldown')
var mtb36 = require('monotonic-timestamp-base36')
var collect = require('@dwcore/dwsc')
var { promisifyModule } = require('../helpers')

// exported api
// =

class ReportsDB extends EventEmitter {
  constructor (dhost) {
    super()
    this.indexDB = sublevel(dhost.db, 'reports-index')

    // create levels and indexer
    this.reportsDB = sublevel(dhost.db, 'reports', { valueEncoding: 'json' })

    this.indexer = createIndexer(this.indexDB, {
      keyName: 'id',
      properties: ['vaultOwner', 'reportingUser', 'vaultKey'],
      map: (id, next) => {
        this.getByID(id)
          .catch(next)
          .then(res => next(null, res))
      }
    })

    // promisify
    levelPromise.install(this.reportsDB)
    levelPromise.install(this.indexDB)
    promisifyModule(this.indexer, ['findOne', 'addIndexes', 'removeIndexes', 'updateIndexes'])
  }

  // basic ops
  // =

  async create (record) {
    assert(record && typeof record === 'object')
    assert(typeof record.vaultKey === 'string')

    record = Object.assign({}, ReportsDB.defaults(), record)
    record.id = `${record.vaultKey}:${mtb36()}`
    record.createdAt = Date.now()

    await this.put(record)
    this.emit('create', record)
    return record
  }

  async put (record) {
    assert(typeof record.id === 'string')
    record.updatedAt = Date.now()
    await this.reportsDB.put(record.id, record)
    await this.indexer.updateIndexes(record)
    this.emit('put', record)
  }

  async del (record) {
    assert(record && typeof record === 'object')
    assert(typeof record.id === 'string')
    await this.reportsDB.del(record.id)
    await this.indexer.removeIndexes(record)
    this.emit('del', record)
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
      if (sort === 'vaultOwner') stream = this.indexer.find('vaultOwner', opts)
      else if (sort === 'reportingUser') stream = this.indexer.find('reportingUser', opts)
      else if (sort === 'vaultKey') stream = this.indexer.find('vaultKey', opts)
      else stream = this.reportsDB.createValueStream(opts)
      // collect into an array
      collect(stream, (err, res) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }

  // getters

  async getByID (id) {
    assert(typeof id === 'string')
    try {
      return await this.reportsDB.get(id)
    } catch (e) {
      if (e.notFound) return null
      throw e
    }
  }

  async getByVaultKey (key) {
    assert(typeof key === 'string')
    return new Promise((resolve, reject) => {
      collect(this.indexer.find('vaultKey', key), (err, res) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }

  async getByVaultOwner (id) {
    assert(typeof id === 'string')
    return new Promise((resolve, reject) => {
      collect(this.indexer.find('vaultOwner', id), (err, res) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }

  async getByReportingUser (id) {
    assert(typeof id === 'string')
    return new Promise((resolve, reject) => {
      collect(this.indexer.find('reportingUser', id), (err, res) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }
}

module.exports = ReportsDB

// default user-record values
ReportsDB.defaults = () => ({
  vaultKey: null,

  vaultOwner: null,
  reportingUser: null,

  reason: '',
  status: 'open',
  notes: '',

  createdAt: 0
})
