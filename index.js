const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const expressValidator = require('express-validator')
const RateLimit = require('express-rate-limit')
const csurf = require('csurf')
const vhost = require('vhost')
const bytes = require('bytes')
const lessExpress = require('less-express')
const ejs = require('ejs')
const figures = require('figures')

const DistributedHosting = require('./lib')
const customValidators = require('./lib/validators')
const customSanitizers = require('./lib/sanitizers')
const analytics = require('./lib/analytics')
const packageJson = require('./package.json')

module.exports = async function (config) {
  console.log(figures.heart, 'Hello friend')
  console.log(figures.pointerSmall, 'Instantiating backend')
  addConfigHelpers(config)
  var dhost = new DistributedHosting(config)
  dhost.version = packageJson.version
  await dhost.setupDatabase() // pause all loading during DB setup
  dhost.loadAllVaults()
  dhost.setupAdminUser()

  console.log(figures.pointerSmall, 'Instantiating server')
  var app = express()
  if (config.proxy) {
    app.set('trust proxy', 'loopback')
  }
  app.dhost = dhost
  app.config = config
  app.approveDomains = approveDomains(config, dhost)

  app.locals = {
    session: false, // default session value
    sessionUser: false,
    errors: false, // common default value
    // Using the stripe publishable key to identify whether or not to show pricing related information
    // on any page
    stripePK: config.stripe ? config.stripe.publishableKey : null,
    appInfo: {
      version: dhost.version,
      brandname: config.brandname,
      hostname: config.hostname,
      port: config.port,
      proDiskUsageLimit: config.proDiskUsageLimit
    }
  }

  app.engine('html', ejs.renderFile)
  app.engine('ejs', ejs.renderFile)
  app.set('view engine', 'html')
  app.set('views', path.join(__dirname, 'assets/html'))

  app.use(cookieParser())
  app.use(bodyParser.json())
  app.use(expressValidator({ customValidators, customSanitizers }))
  app.use(dhost.sessions.middleware())
  if (config.rateLimiting) {
    app.use(new RateLimit({windowMs: 10e3, max: 100, delayMs: 0})) // general rate limit
    // app.use('/v1/verify', actionLimiter(24, 'Too many accounts created from this IP, please try again after an hour'))
    app.use('/v1/login', actionLimiter(60 * 60 * 1000, 5, 'Too many login attempts from this IP, please try again after an hour'))
    // app.use('/v2/accounts/verify', actionLimiter(24, 'Too many accounts created from this IP, please try again after an hour'))
    app.use('/v2/accounts/login', actionLimiter(60 * 60 * 1000, 5, 'Too many login attempts from this IP, please try again after an hour'))
  }

  // monitoring
  // =

  if (config.pm2) {
    let pmx = require('pmx')
    pmx.init({
      http: true, // HTTP routes logging (default: true)
      ignore_routes: [], // Ignore http routes with this pattern (Default: [])
      errors: true, // Exceptions logging (default: true)
      custom_probes: true, // Auto expose JS Loop Latency and HTTP req/s as custom metrics
      network: true, // Network monitoring at the application level
      ports: true  // Shows which ports your app is listening on (default: false)
    })
    require('./lib/monitoring').init(config, dhost, pmx)
  }

  // http gateway
  // =

  if (config.sites) {
    var httpGatewayApp = express()
    httpGatewayApp.locals = app.locals
    httpGatewayApp.engine('html', ejs.renderFile)
    httpGatewayApp.set('view engine', 'html')
    httpGatewayApp.set('views', path.join(__dirname, 'assets/html'))
    httpGatewayApp.get('/.well-known/dpack', dhost.api.vaultFiles.getDNSFile)
    httpGatewayApp.get('*', dhost.api.vaultFiles.getFile)
    httpGatewayApp.use((err, req, res, next) => {
      if (err) {
        res.json(err.body || err)
      } else {
        next()
      }
    })
    app.use(vhost('*.' + config.hostname, httpGatewayApp))
  }

  // assets
  // =

  app.get('/assets/css/main.css', lessExpress(path.join(__dirname, 'assets/css/main.less')))

  // css for individual pages
  app.get('/assets/css/about.css', lessExpress(path.join(__dirname, 'assets/css/pages/about.less')))
  app.get('/assets/css/account.css', lessExpress(path.join(__dirname, 'assets/css/pages/account.less')))
  app.get('/assets/css/admin-dashboard.css', lessExpress(path.join(__dirname, 'assets/css/pages/admin-dashboard.less')))
  app.get('/assets/css/vault.css', lessExpress(path.join(__dirname, 'assets/css/pages/vault.less')))
  app.get('/assets/css/error.css', lessExpress(path.join(__dirname, 'assets/css/pages/error.less')))
  app.get('/assets/css/home.css', lessExpress(path.join(__dirname, 'assets/css/pages/home.less')))
  app.get('/assets/css/pricing.css', lessExpress(path.join(__dirname, 'assets/css/pages/pricing.less')))
  app.get('/assets/css/profile.css', lessExpress(path.join(__dirname, 'assets/css/pages/profile.less')))
  app.get('/assets/css/support.css', lessExpress(path.join(__dirname, 'assets/css/pages/support.less')))

  app.use('/assets/css', express.static(path.join(__dirname, 'assets/css')))
  app.use('/assets/js', express.static(path.join(__dirname, 'assets/js')))
  app.use('/assets/fonts', express.static(path.join(__dirname, 'assets/fonts')))
  app.use('/assets/images', express.static(path.join(__dirname, 'assets/images')))

  // ----------------------------------------------------------------------------------
  // add analytics for routes declared below here
  // ----------------------------------------------------------------------------------
  app.use(analytics.middleware(dhost))

  // Create separater router for API
  const apiv1 = createV1ApiRouter(dhost, config)
  const apiv2 = createV2ApiRouter(dhost, config)

  // Use api routes before applying csurf middleware
  app.use('/v1', apiv1)
  app.use('/v2', apiv2)

  // Then apply csurf
  app.use(config.csrf ? csurf({cookie: true}) : fakeCSRF)

  // service apis
  // =

  app.get('/', dhost.api.service.frontpage)
  app.get('/.well-known/psa', dhost.api.service.psaDoc)
  app.get('/v1/explore', dhost.api.service.explore)
  app.get('/v2/explore', dhost.api.service.explore)

  // pages
  // =

  app.get('/', dhost.api.pages.frontpage)
  app.get('/explore', dhost.api.pages.explore)
  app.get('/new-vault', dhost.api.pages.newVault)
  app.get('/about', dhost.api.pages.about)
  app.get('/pricing', dhost.api.pages.pricing)
  app.get('/terms', dhost.api.pages.terms)
  app.get('/privacy', dhost.api.pages.privacy)
  app.get('/acceptable-use', dhost.api.pages.acceptableUse)
  app.get('/support', dhost.api.pages.support)
  app.get('/login', dhost.api.pages.login)
  app.get('/forgot-password', dhost.api.pages.forgotPassword)
  app.get('/reset-password', dhost.api.pages.resetPassword)
  app.get('/register', dhost.api.pages.register)
  if (config.stripe) {
    app.get('/register/pro', dhost.api.pages.registerPro)
  }
  app.get('/registered', dhost.api.pages.registered)
  app.get('/profile', dhost.api.pages.profileRedirect)
  if (config.stripe) {
    app.get('/account/upgrade', dhost.api.pages.accountUpgrade)
    app.get('/account/upgraded', dhost.api.pages.accountUpgraded)
    app.get('/account/cancel-plan', dhost.api.pages.accountCancelPlan)
    app.get('/account/canceled-plan', dhost.api.pages.accountCanceledPlan)
  }
  app.get('/account/change-password', dhost.api.pages.accountChangePassword)
  app.get('/account/update-email', dhost.api.pages.accountUpdateEmail)
  app.get('/account', dhost.api.pages.account)

  // user pages
  // =

  app.get('/:username([a-z0-9]{1,})/:vaultname([a-z0-9-]{1,})', dhost.api.userContent.viewVault)
  app.get('/:username([a-z0-9]{1,})', dhost.api.userContent.viewUser)

  // (json) error-handling fallback
  // =

  app.use((err, req, res, next) => {
    var contentType = req.accepts(['json', 'html'])
    if (!contentType) {
      return next()
    }

    // CSRF error
    if (err.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({
        message: 'The form has entered an invalid state. Please refresh and try submitting again. If this persists, please contact support.',
        badCSRF: true
      })
    }
    // validation errors
    if ('isEmpty' in err) {
      return res.status(422).json({
        message: 'There were errors in your submission',
        invalidInputs: true,
        details: err.mapped()
      })
    }

    // common errors
    if ('status' in err) {
      res.status(err.status)
      if (contentType === 'json') {
        res.json(err.body)
      } else {
        try {
          res.render('error.html', { error: err })
        } catch (e) {
          // HACK
          // I cant figure out why res.render() fails sometimes
          // something about the view engine?
          // fallback to json and report the issue
          // -prf
          if (config.pm2) {
            require('pmx').emit('debug:view-render-error', {
              wasRendering: err,
              threwThis: e
            })
          }
          res.json(err.body)
        }
      }
      return
    }

    // general uncaught error
    console.error('[ERROR]', err)
    res.status(500)
    var error = {
      message: 'Internal server error',
      internalError: true
    }
    if (contentType === 'json') {
      res.json(error)
    } else {
      res.render('error', { error })
    }
  })

  // error handling
  // =

  process.on('uncaughtException', console.error)

  process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  })

  // shutdown
  // =

  app.close = dhost.close.bind(dhost)

  return app
}

function createV1ApiRouter (dhost, config) {
  const router = new express.Router()

  // user & auth apis
  // =

  router.post('/register', dhost.api.users.doRegister)
  router.all('/verify', dhost.api.users.verify)
  router.get('/account', dhost.api.users.getAccount)
  router.post('/account', dhost.api.users.updateAccount)
  router.post('/account/password', dhost.api.users.updateAccountPassword)
  router.post('/account/email', dhost.api.users.updateAccountEmail)
  if (config.stripe) {
    router.post('/account/upgrade', dhost.api.users.upgradePlan)
    router.post('/account/register/pro', dhost.api.users.registerPro)
    router.post('/account/update-card', dhost.api.users.updateCard)
    router.post('/account/cancel-plan', dhost.api.users.cancelPlan)
  }
  router.post('/login', dhost.api.users.doLogin)
  router.get('/logout', dhost.api.users.doLogout)
  router.post('/forgot-password', dhost.api.users.doForgotPassword)
  router.get('/users/:username([^/]{3,})', dhost.api.users.get)

  // vaults apis
  // =

  router.post('/vaults/add', dhost.api.vaults.add)
  router.post('/vaults/remove', dhost.api.vaults.remove)
  router.get('/vaults/:key([0-9a-f]{64})', dhost.api.vaults.get)
  router.get('/users/:username([^/]{3,})/:vaultname', dhost.api.vaults.getByName)

  // reports apis
  router.post('/reports/add', dhost.api.reports.add)

  // admin apis
  // =

  router.get('/admin', dhost.api.admin.getDashboard)
  router.get('/admin/users', dhost.api.admin.listUsers)
  router.get('/admin/users/:id', dhost.api.admin.getUser)
  router.post('/admin/users/:id', dhost.api.admin.updateUser)
  router.post('/admin/users/:id/suspend', dhost.api.admin.suspendUser)
  router.post('/admin/users/:id/unsuspend', dhost.api.admin.unsuspendUser)
  router.post('/admin/users/:id/resend-email-confirmation', dhost.api.admin.resendEmailConfirmation)
  router.post('/admin/users/:username/send-email', dhost.api.admin.sendEmail)
  router.post('/admin/vaults/:key/feature', dhost.api.admin.featureVault)
  router.post('/admin/vaults/:key/unfeature', dhost.api.admin.unfeatureVault)
  router.get('/admin/vaults/:key', dhost.api.admin.getVault)
  router.post('/admin/vaults/:key/remove', dhost.api.admin.removeVault)
  router.get('/admin/analytics/events', dhost.api.admin.getAnalyticsEventsList)
  router.get('/admin/analytics/events-count', dhost.api.admin.getAnalyticsEventsCount)
  router.get('/admin/analytics/events-stats', dhost.api.admin.getAnalyticsEventsStats)
  router.get('/admin/analytics/cohorts', dhost.api.admin.getAnalyticsCohorts)
  router.get('/admin/reports', dhost.api.admin.getReports)
  router.get('/admin/reports/:id', dhost.api.admin.getReport)
  router.post('/admin/reports/:id', dhost.api.admin.updateReport)
  router.post('/admin/reports/:id/close', dhost.api.admin.closeReport)
  router.post('/admin/reports/:id/open', dhost.api.admin.openReport)

  return router
}

function createV2ApiRouter (dhost, config) {
  const router = new express.Router()

  // user & auth apis
  // =

  router.post('/accounts/register', dhost.api.users.doRegister)
  router.all('/accounts/verify', dhost.api.users.verify)
  router.get('/accounts/account', dhost.api.users.getAccount)
  router.post('/accounts/account', dhost.api.users.updateAccount)
  router.post('/accounts/account/password', dhost.api.users.updateAccountPassword)
  router.post('/accounts/account/email', dhost.api.users.updateAccountEmail)
  if (config.stripe) {
    router.post('/accounts/account/upgrade', dhost.api.users.upgradePlan)
    router.post('/accounts/account/register/pro', dhost.api.users.registerPro)
    router.post('/accounts/account/update-card', dhost.api.users.updateCard)
    router.post('/accounts/account/cancel-plan', dhost.api.users.cancelPlan)
  }
  router.post('/accounts/login', dhost.api.users.doLogin)
  router.get('/accounts/logout', dhost.api.users.doLogout)
  router.post('/accounts/logout', dhost.api.users.doLogout)
  router.post('/accounts/forgot-password', dhost.api.users.doForgotPassword)
  router.get('/users/:username([^/]{3,})', dhost.api.users.get)

  // vaults apis
  // =

  router.post('/vaults/add', dhost.api.vaults.add)
  router.post('/vaults/remove', dhost.api.vaults.remove)
  router.get('/vaults', dhost.api.vaults.list)
  router.get('/vaults/item/:key([0-9a-f]{64})', dhost.api.vaults.get)
  router.post('/vaults/item/:key([0-9a-f]{64})', dhost.api.vaults.update)
  router.get('/users/:username([^/]{3,})/:vaultname', dhost.api.vaults.getByName)

  // reports apis
  router.post('/reports/add', dhost.api.reports.add)

  // admin apis
  // =

  router.get('/admin', dhost.api.admin.getDashboard)
  router.get('/admin/users', dhost.api.admin.listUsers)
  router.get('/admin/users/:id', dhost.api.admin.getUser)
  router.post('/admin/users/:id', dhost.api.admin.updateUser)
  router.post('/admin/users/:id/suspend', dhost.api.admin.suspendUser)
  router.post('/admin/users/:id/unsuspend', dhost.api.admin.unsuspendUser)
  router.post('/admin/users/:id/resend-email-confirmation', dhost.api.admin.resendEmailConfirmation)
  router.post('/admin/users/:username/send-email', dhost.api.admin.sendEmail)
  router.post('/admin/vaults/:key/feature', dhost.api.admin.featureVault)
  router.post('/admin/vaults/:key/unfeature', dhost.api.admin.unfeatureVault)
  router.get('/admin/vaults', dhost.api.admin.listVaults)
  router.get('/admin/vaults/:key', dhost.api.admin.getVault)
  router.post('/admin/vaults/:key/remove', dhost.api.admin.removeVault)
  router.get('/admin/analytics/events', dhost.api.admin.getAnalyticsEventsList)
  router.get('/admin/analytics/events-count', dhost.api.admin.getAnalyticsEventsCount)
  router.get('/admin/analytics/events-stats', dhost.api.admin.getAnalyticsEventsStats)
  router.get('/admin/analytics/cohorts', dhost.api.admin.getAnalyticsCohorts)
  router.get('/admin/reports', dhost.api.admin.getReports)
  router.get('/admin/reports/:id', dhost.api.admin.getReport)
  router.post('/admin/reports/:id', dhost.api.admin.updateReport)
  router.post('/admin/reports/:id/close', dhost.api.admin.closeReport)
  router.post('/admin/reports/:id/open', dhost.api.admin.openReport)

  return router
}

function actionLimiter (windowMs, max, message) {
  return new RateLimit({
    windowMs,
    delayMs: 0,
    max,
    message
  })
}

function addConfigHelpers (config) {
  config.getUserDiskQuota = (userRecord) => {
    return userRecord.diskQuota || bytes(config.defaultDiskUsageLimit)
  }
  config.getUserDiskQuotaPct = (userRecord) => {
    return userRecord.diskUsage / config.getUserDiskQuota(userRecord)
  }
}

function approveDomains (config, dhost) {
  return async (options, certs, cb) => {
    var {domain} = options
    options.agreeTos = true
    options.email = config.letsencrypt.email

    // toplevel domain?
    if (domain === config.hostname) {
      return cb(null, {options, certs})
    }

    // try looking up the site
    try {
      var vaultName
      var userName
      var domainParts = domain.split('.')
      if (config.sites === 'per-user') {
        // make sure the user record exists
        userName = domainParts[0]
        await dhost.usersDB.getByUsername(userName)
        return cb(null, {options, certs})
      } else if (config.sites === 'per-vault') {
        // make sure the user and vault records exists
        vaultName = domainParts[0]
        let vaultRecord = await dhost.vaultsDB.getByName(vaultName)
        if (vaultRecord) {
          return cb(null, {options, certs})
        }
      }
    } catch (e) {}
    cb(new Error('Invalid domain'))
  }
}

function fakeCSRF (req, res, next) {
  req.csrfToken = () => 'csrf is disabled'
  next()
}
