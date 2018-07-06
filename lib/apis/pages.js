const nicedate = require('nicedate')
const bytes = require('bytes')
const {ForbiddenError} = require('../const')
const {pluralize, ucfirst} = require('../helpers')

// exported api
// =

class PagesAPI {
  constructor (dhost) {
    this.dhost = dhost
    this.config = dhost.config
  }

  async frontpage (req, res) {
    var user = res.locals.sessionUser
    var diskUsage = user ? user.diskUsage : undefined
    var diskQuota = user ? this.config.getUserDiskQuota(user) : undefined
    var diskUsagePct = user ? this.config.getUserDiskQuotaPct(user) * 100 : undefined

    var [featured, recent, popular] = await Promise.all([
      this.dhost.featuredVaultsDB.list(),
      this.dhost.vaultsDB.list({
        sort: 'createdAt',
        reverse: true,
        limit: 25
      }),
      (user && user.scopes.includes('admin:dpacks'))
        ? this.dhost.vaultsDB.list({
          sort: 'popular',
          limit: 25
        })
        : false
    ])
    var userVaults = []
    if (user) {
      userVaults = await Promise.all(user.vaults.map(async (record) => {
        var vault = this.dhost.vaultr.vaults[record.key]
        if (vault) {
          record.manifest = await this.dhost.vaultr.getManifest(vault.key)
          record.title = record.manifest ? record.manifest.title : false
          record.numPeers = vault.numPeers
          record.diskUsage = await this.dhost.vaultr.getVaultDiskUsage(vault.key)
          return record
        }
      }))
      userVaults = userVaults.filter(Boolean)
    }

    let peerCount = 0
    if (userVaults.length) {
      peerCount = userVaults
        .map(a => a.numPeers)
        .reduce((sum, val) => sum + val)
    }

    res.render('frontpage', {
      verified: req.query.verified,
      userVaults,
      nicedate,
      featured,
      popular,
      recent,
      bytes,
      diskUsage,
      diskUsagePct,
      diskQuota,
      peerCount
    })
  }

  async explore (req, res) {
    if (req.query.view === 'activity') {
      return res.render('explore-activity', {
        nicedate,
        activityLimit: 25,
        activity: await this.dhost.activityDB.listGlobalEvents({
          limit: 25,
          lt: req.query.start,
          reverse: true
        })
      })
    }
    var users = await this.dhost.usersDB.list()
    res.render('explore', {users})
  }

  async newVault (req, res) {
    var {session, sessionUser} = res.locals
    if (!session || !sessionUser) res.redirect('/login?redirect=new-vault')

    res.render('new-vault', {
      diskUsage: (sessionUser.diskUsage / (1 << 20)) | 0,
      diskQuota: (this.config.getUserDiskQuota(sessionUser) / (1 << 20)) | 0,
      csrfToken: req.csrfToken()
    })
  }

  about (req, res) {
    res.render('about')
  }

  pricing (req, res) {
    res.render('pricing')
  }

  terms (req, res) {
    res.render('terms')
  }

  privacy (req, res) {
    res.render('privacy')
  }

  acceptableUse (req, res) {
    res.render('acceptable-use')
  }

  support (req, res) {
    res.render('support')
  }

  login (req, res) {
    if (res.locals.session) {
      return res.redirect('/account')
    }

    res.render('login', {
      reset: req.query.reset, // password reset
      csrfToken: req.csrfToken()
    })
  }

  forgotPassword (req, res) {
    res.render('forgot-password', {
      csrfToken: req.csrfToken()
    })
  }

  resetPassword (req, res) {
    // basic check for nonce and username queries
    if (!(req.query.nonce && req.query.username)) throw new ForbiddenError()

    res.render('reset-password', {
      csrfToken: req.csrfToken()
    })
  }

  register (req, res) {
    if (res.locals.session) {
      if (req.query.pro) {
        res.redirect('/account/upgrade')
      } else {
        res.redirect('/account')
      }
      return
    }

    res.render('register', {
      isOpen: this.config.registration.open,
      isProSignup: req.query.pro,
      csrfToken: req.csrfToken()
    })
  }

  registerPro (req, res) {
    if (res.locals.session) {
      return res.redirect('/account')
    }

    // basic check for user ID and email
    if (!(req.query.id && req.query.email)) throw new ForbiddenError()

    res.render('register-pro', {
      id: req.query.id,
      email: req.query.email,
      salesTax: this.config.stripe ? this.config.stripe.salesTaxPct : null,
      csrfToken: req.csrfToken()
    })
  }

  registered (req, res) {
    res.render('registered', {email: req.query.email})
  }

  async profileRedirect (req, res) {
    var {sessionUser} = res.locals
    if (sessionUser) {
      res.redirect(`/${sessionUser.username}`)
    } else {
      res.redirect('/login?redirect=profile')
    }
  }

  async account (req, res) {
    var {session, sessionUser} = res.locals
    if (!session) return res.redirect('/login?redirect=account')

    var diskUsage = sessionUser ? sessionUser.diskUsage : undefined
    var diskQuota = sessionUser ? this.config.getUserDiskQuota(sessionUser) : undefined

    res.render('account', {
      updated: req.query.updated,
      ucfirst,
      pluralize,
      bytes,
      diskUsage,
      diskQuota,
      diskUsagePct: (this.config.getUserDiskQuotaPct(sessionUser) * 100) | 0,
      csrfToken: req.csrfToken()
    })
  }

  async accountUpgrade (req, res) {
    var {session} = res.locals
    if (!session) return res.redirect('/login?redirect=account/upgrade')
    res.render('account-upgrade', {
      salesTax: this.config.stripe ? this.config.stripe.salesTaxPct : null,
      csrfToken: req.csrfToken()
    })
  }

  async accountUpgraded (req, res) {
    var {session} = res.locals
    if (!session) throw new ForbiddenError()
    res.render('account-upgraded')
  }

  async accountCancelPlan (req, res) {
    var {session} = res.locals
    if (!session) throw new ForbiddenError()
    res.render('account-cancel-plan', {
      csrfToken: req.csrfToken()
    })
  }

  async accountCanceledPlan (req, res) {
    var {session} = res.locals
    if (!session) throw new ForbiddenError()
    res.render('account-canceled-plan')
  }

  async accountChangePassword (req, res) {
    res.render('account-change-password', {
      csrfToken: req.csrfToken()
    })
  }

  accountUpdateEmail (req, res) {
    var {session} = res.locals
    if (!session) throw new ForbiddenError()
    res.render('account-update-email', {
      csrfToken: req.csrfToken()
    })
  }
}

module.exports = PagesAPI
