var {NotImplementedError} = require('../const')

// exported api
// =

module.exports = class ServicesAPI {
  constructor (dhost) {
    this.config = dhost.config
    this.usersDB = dhost.usersDB
    this.activityDB = dhost.activityDB
    this.vaultsDB = dhost.vaultsDB
    this.featuredVaultsDB = dhost.featuredVaultsDB
  }

  async frontpage (req, res, next) {
    var contentType = req.accepts(['html', 'json'])
    if (contentType === 'json') throw new NotImplementedError()
    next()
  }

  async psaDoc (req, res) {
    return res.status(200).json({
      PSA: 1,
      title: this.config.brandname,
      description: 'A public peer service for the dWeb',
      links: [{
        rel: 'https://vault.org/services/purl/purl/dweb/spec/pinning-service-account-api',
        title: 'User accounts API',
        href: '/v2/accounts'
      }, {
        rel: 'https://vault.org/services/purl/purl/dweb/spec/pinning-service-dpacks-api',
        title: 'dPack pinning API',
        href: '/v2/vaults'
      }]
    })
  }

  async explore (req, res, next) {
    if (req.query.view === 'activity') {
      return res.json({
        activity: await this.activityDB.listGlobalEvents({
          limit: 25,
          lt: req.query.start,
          reverse: true
        })
      })
    }
    if (req.query.view === 'featured') {
      return res.json({
        featured: (await this.featuredVaultsDB.list()).map(mapVaultObject)
      })
    }
    if (req.query.view === 'popular') {
      return res.json({
        popular: (await this.vaultsDB.list({
          sort: 'popular',
          limit: 25,
          cursor: req.query.start
        })).map(mapVaultObject)
      })
    }
    if (req.query.view === 'recent') {
      return res.json({
        recent: (await this.vaultsDB.list({
          sort: 'createdAt',
          limit: 25,
          cursor: req.query.start
        })).map(mapVaultObject)
      })
    }
    next()
  }
}

function mapVaultObject (vault) {
  return {
    key: vault.key,
    numPeers: vault.numPeers,
    name: vault.name,
    title: vault.manifest ? vault.manifest.title : null,
    description: vault.manifest ? vault.manifest.description : null,
    owner: vault.owner ? vault.owner.username : null,
    createdAt: vault.createdAt
  }
}
