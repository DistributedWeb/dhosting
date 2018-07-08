const assert = require('assert')
const figures = require('figures')
const pump = require('pump')
const through2 = require('through2')

// constants
// =

const CURRENT_DB_VERSION = 4

// exported api
// =

class Schemas {
  constructor (dhost) {
    this.dhost = dhost
  }

  // basic ops
  // =

  async getDBVersion () {
    return new Promise((resolve, reject) => {
      this.dhost.db.get('db-version', (err, v) => {
        if (err && err.notFound) resolve(1) // default to 1
        else if (!err) resolve(+v)
        else reject(err)
      })
    })
  }

  async setDBVersion (v) {
    assert(typeof v === 'number')
    return new Promise((resolve, reject) => {
      this.dhost.db.put('db-version', v, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  // migrations
  // =

  async migrate () {
    var v = await this.getDBVersion()
    if (v >= CURRENT_DB_VERSION) {
      console.log(figures.tick, 'Database loaded at version', v)
      return
    }

    console.log(figures.pointerSmall, 'Running database migrations to bring version', v, 'to version', CURRENT_DB_VERSION)
    for (v; v < CURRENT_DB_VERSION; v++) {
      console.log(figures.pointerSmall, `v${v} migration started...`)
      await this[`to${v + 1}`]()
    }
    await this.setDBVersion(CURRENT_DB_VERSION)
    console.log(figures.tick, 'Database updated to version', v)
  }

  async to2 () {
    /**
    In V2, we had two changes around how vaults work:

      1. Vault subdomains are no longer post-fixed by the username.
         An vault with the name 'foo' will be at 'foo.dhosting.io', not 'foo-bob.dhosting.io'.
      2. Vault records now record some "denormalized" data for performance.
         That data is their name, and their owner's name.

    At time of migration, we need to populate all of the denormalization fields, but also --

    #1 is a change to user-facing policy. To make the transition smooth, we rename all vaults so
    that the new policy has no immediate effect. The previous policy was that an vault was hosted
    at 'vaultname-username.dhosting.io' unless 'vaultname' === 'username', in which case it was
    hosted at 'username.dhosting.io'. This leads us to the following rules:

      - If 'vaultname' !== 'username', then 'vaultname' = `${vaultname}-${username}`
      - Else, then 'vaultname' = 'vaultname'

    **/
    return new Promise((resolve, reject) => {
      pump(
        // stream the users
        this.dhost.usersDB.accountsDB.createValueStream(),
        through2.obj(async (userRecord, enc, cb) => {
          // sanity check
          if (!userRecord || !userRecord.vaults || !Array.isArray(userRecord.vaults)) {
            console.log('skipping bad user record', userRecord)
            return cb() // skip it
          }

          // iterate their vaults
          for (let vault of userRecord.vaults) {
            // update the name
            if (!vault.name || vault.name === userRecord.username) {
              // do nothing
            } else {
              // rename
              let oldName = vault.name
              vault.name = `${vault.name}-${userRecord.username}`
              console.log('setting', oldName, 'to', vault.name)
            }

            // update the vault record
            await this.dhost.vaultsDB.update(vault.key, {
              name: vault.name,
              ownerName: userRecord.username
            })
          }

          // update the user record
          await this.dhost.usersDB.update(userRecord.id, userRecord)
          cb()
        }),
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }

  async to3 () {
    /**
    In V3, we added upgradable named-vault quotas, so we just need to set defaults for people on the pro plans.
    **/
    return new Promise((resolve, reject) => {
      pump(
        // stream the users
        this.dhost.usersDB.accountsDB.createValueStream(),
        through2.obj(async (userRecord, enc, cb) => {
          // sanity check
          if (!userRecord) {
            console.log('skipping bad user record', userRecord)
            return cb() // skip it
          }

          if (userRecord.plan === 'pro' && !userRecord.namedVaultQuota) {
            // update the user record
            console.log('setting', userRecord.username, 'namedVaultQuota to', this.dhost.config.proNamedVaultsLimit)
            userRecord.namedVaultQuota = this.dhost.config.proNamedVaultsLimit
            await this.dhost.usersDB.update(userRecord.id, userRecord)
          }

          cb()
        }),
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }

  async to4 () {
    /**
    In V4, we switched the keys used by the activity DB
    **/
    var allEvents = await this.dhost.activityDB.listGlobalEvents()
    allEvents.sort((a, b) => a.ts - b.ts) // oldest to newest
    for (let event of allEvents) {
      // delete old entry
      await this.dhost.activityDB.delGlobalEvent(event.key)

      // write new entry with new key scheme
      delete event.key
      await this.dhost.activityDB.writeGlobalEvent(event, {doNotModify: true})
    }
  }
}
module.exports = Schemas
