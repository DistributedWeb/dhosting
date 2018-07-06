const assert = require('assert')
const levelPromise = require('level-promise')
const sublevel = require('subleveldown')
const collect = require('@dwcore/dwsc')

// exported api
// =

class FeaturedVaultsDB {
  constructor (dhost) {
    // create levels and indexer
    this.vaultsDB = dhost.vaultsDB
    this.featuredDB = sublevel(dhost.db, 'featured-vaults', { valueEncoding: 'json' })

    // promisify
    levelPromise.install(this.featuredDB)

    // connect to vaults emitters
    dhost.vaultsDB.on('del', this.onVaultDel.bind(this))
  }

  // event handlers
  //

  onVaultDel (record) {
    this.remove(record.key)
  }

  // basic ops
  // =

  async add (key) {
    assert(typeof key === 'string')
    await this.featuredDB.put(key, null)
  }

  async remove (key) {
    assert(typeof key === 'string')
    await this.featuredDB.del(key)
  }

  // getters
  // =

  async has (key) {
    assert(typeof key === 'string')
    try {
      await this.featuredDB.get(key)
      return true // if it doesnt fail, the key exists
    } catch (e) {
      return false
    }
  }

  async list () {
    var keys = await new Promise((resolve, reject) => {
      collect(this.featuredDB.createKeyStream(), (err, res) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
    var vaults = await Promise.all(keys.map(key => (
      this.vaultsDB.getExtraByKey(key)
    )))
    vaults.sort(sortByPeerCount)
    return vaults
  }
}
module.exports = FeaturedVaultsDB

function sortByPeerCount (a, b) {
  return b.numPeers - a.numPeers
}
