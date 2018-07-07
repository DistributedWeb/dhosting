const querystring = require('querystring')
const bytes = require('bytes')
const {NotFoundError, UnauthorizedError, ForbiddenError, ADMIN_MODIFIABLE_FIELDS_USER, ADMIN_MODIFIABLE_FIELDS_REPORT} = require('../const')
const lock = require('../lock')
const {randomBytes} = require('../crypto')

// exported api
// =

module.exports = class AdminAPI {
  constructor (dhost) {
    this.analytics = dhost.analytics
    this.usersDB = dhost.usersDB
    this.featuredVaultsDB = dhost.featuredVaultsDB
    this.vaultsDB = dhost.vaultsDB
    this.activityDB = dhost.activityDB
    this.reportsDB = dhost.reportsDB
    this.vaultr = dhost.vaultr
    this.mailer = dhost.mailer
    this.config = dhost.config
  }

  async getDashboard (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // respond
    res.render('admin-dashboard-stats')
  }

  async listUsers (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    // html requests
    if (req.accepts('html')) {
      return res.render('admin-dashboard-users')
    }

    // fetch
    var users
    if (req.query.view === 'dashboard') {
      // pull down all records, the client is going to handle everything
      users = await this.usersDB.list()
      users = users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        numVaults: user.vaults.length,
        diskUsage: bytes.format(user.diskUsage),
        diskQuota: bytes.format(user.diskQuota),
        plan: user.plan,
        isEmailVerified: user.isEmailVerified,
        suspension: user.suspension,
        createdAt: user.createdAt
      }))
    } else {
      users = await this.usersDB.list({
        cursor: req.query.cursor,
        limit: req.query.limit ? +req.query.limit : 25,
        sort: req.query.sort,
        reverse: +req.query.reverse === 1
      })
    }

    // respond
    res.status(200)
    res.json({users})
  }

  async getUser (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    // fetch
    var user = await this._getUser(req.params.id)

    // respond
    if (req.accepts('html')) {
      return res.render('admin-dashboard-user', {user})
    }
    res.status(200)
    res.json(user)
  }

  async updateUser (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    // validate & sanitize input
    req.checkBody('username').optional()
      .isAlphanumeric().withMessage('Can only be letters and numbers.')
      .isLength({ min: 3, max: 16 }).withMessage('Must be 3 to 16 characters.')
    req.checkBody('email', 'Must be a valid email').optional()
      .isEmail()
      .isSimpleEmail()
      .isLength({ min: 3, max: 100 })
    req.checkBody('scopes', 'Must be an array of strings.').optional()
      .isScopesArray()
    req.checkBody('diskQuota', 'Must be a byte size.').optional()
      .isBytes()
    ;(await req.getValidationResult()).throw()
    if (req.body.diskQuota) req.sanitizeBody('diskQuota').toBytes()

    // keep a list of changes processed
    var changedFields = []

    var release = await lock('users')
    try {
      // fetch
      var user = await this._getUser(req.params.id)

      // update
      ADMIN_MODIFIABLE_FIELDS_USER.forEach(key => {
        if (typeof req.body[key] !== 'undefined') {
          changedFields.push(key)
          user[key] = req.body[key]
        }
      })

      await this.usersDB.put(user)
    } finally {
      release()
    }

    // respond
    res.status(200)
    res.json({user, changedFields})
  }

  async suspendUser (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    var release = await lock('users')
    try {
      // fetch user record
      var user = await this._getUser(req.params.id)

      // update record
      var scopeIndex = user.scopes.indexOf('user')
      if (scopeIndex !== -1) user.scopes.splice(scopeIndex, 1)
      user.suspension = req.body && req.body.reason ? req.body.reason : true
      await this.usersDB.put(user)
    } finally {
      release()
    }

    // respond
    res.status(200).end()
  }

  async unsuspendUser (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    var release = await lock('users')
    try {
      // fetch user record
      var user = await this._getUser(req.params.id)

      // update record
      var scopeIndex = user.scopes.indexOf('user')
      if (scopeIndex === -1) user.scopes.push('user')
      user.suspension = null
      await this.usersDB.put(user)
    } finally {
      release()
    }

    // respond
    res.status(200).end()
  }

  async listVaults (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    // html requests
    if (req.accepts('html')) {
      return res.render('admin-dashboard-vaults')
    }

    // fetch
    var vaults
    if (req.query.view === 'dashboard') {
      // pull down all records, the client is going to handle everything
      vaults = await this.vaultsDB.list()
      vaults = vaults.map(vault => ({
        key: vault.key,
        name: vault.name,
        owner: vault.ownerName,
        diskUsage: vault.numBlocks ? bytes.format(vault.numDownloadedBlocks / vault.numBlocks * vault.numBytes) : 0,
        totalSize: bytes.format(vault.numBytes),
        createdAt: vault.createdAt
      }))
    } else {
      vaults = await this.vaultsDB.list({
        cursor: req.query.cursor,
        limit: req.query.limit ? +req.query.limit : 25,
        sort: req.query.sort,
        reverse: +req.query.reverse === 1
      })
    }

    // respond
    res.status(200)
    res.json({vaults})
  }

  async getVault (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    // fetch from memory
    var vault = await this.vaultr.getVault(req.params.key)
    if (!vault) {
      throw new NotFoundError()
    }
    res.status(200)
    res.json({
      key: req.params.key,
      numPeers: vault.numPeers,
      manifest: await this.vaultr.getManifest(req.params.key),
      flockOpts: vault.flockOpts,
      diskUsage: vault.diskUsage
    })
  }

  async removeVault (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // validate & sanitize input
    req.checkBody('key').isDWebHash()
    ;(await req.getValidationResult()).throw()
    var { key } = req.body

    if (!key) {
      return res.status(422).json({
        message: 'Must provide a key',
        invalidInputs: true
      })
    }

    // get the admin user's record
    var adminUserRecord = await this.usersDB.getByID(res.locals.session.id)

    var release = await Promise.all([lock('users'), lock('vaults')])
    try {
      // get the vaultRecord
      var vaultRecord = await this.vaultsDB.getExtraByKey(key)

      // update the records
      for (var i = 0; i < vaultRecord.hostingUsers.length; i++) {
        let userID = vaultRecord.hostingUsers[i]
        await this.usersDB.removeVault(userID, key)
        await this.vaultsDB.removeHostingUser(key, userID)
      }
    } finally {
      release[0]()
      release[1]()
    }

    // record the event
    /* dont await */ this.activityDB.writeGlobalEvent({
      userid: adminUserRecord.id,
      username: adminUserRecord.username,
      action: 'del-vault',
      params: {key, name: vaultRecord.name}
    })

    // remove from the flock
    var vault = await this.vaultsDB.getByKey(key)
    if (!vault.hostingUsers.length) {
      await this.vaultr.closeVault(key)
    }

    // respond
    res.status(200).end()
  }

  async sendEmail (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    var {message, subject, username} = req.body
    if (!(message && subject && username)) {
      return res.status(422).json({
        message: 'Must include a message and subject line'
      })
    }

    // fetch user record
    var userRecord = await this.usersDB.getByUsername(username)

    if (!userRecord) throw new NotFoundError()

    this.mailer.send('support', {
      email: userRecord.email,
      subject,
      message,
      username,
      brandname: this.config.brandname
    })
    res.status(200).end()
  }

  async resendEmailConfirmation (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:users')) throw new ForbiddenError()

    // generate email verification nonce
    let emailVerificationNonce = (await randomBytes(32)).toString('hex')

    // update user
    var userRecord = await this.usersDB.update(req.params.id, {emailVerificationNonce})

    // send email
    var qs = querystring.stringify({
      username: userRecord.username, nonce: emailVerificationNonce
    })
    this.mailer.send('verification', {
      email: userRecord.email,
      username: userRecord.username,
      emailVerificationNonce,
      emailVerificationLink: `https://${this.config.hostname}/v2/accounts/verify?${qs}`
    })
    // log the verification link
    if (this.config.env === 'development') {
      console.log('Verify link for', userRecord.username)
      console.log(`https://${this.config.hostname}/v2/accounts/verify?${qs}`)
    }

    // respond
    res.status(200).end()
  }

  async featureVault (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // update db
    await this.featuredVaultsDB.add(req.params.key)
    res.status(200).end()
  }

  async unfeatureVault (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // update db
    await this.featuredVaultsDB.remove(req.params.key)
    res.status(200).end()
  }

  async getAnalyticsEventsList (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // run query
    var events = await this.analytics.listVisits({
      unique: req.query.unique
    })

    // respond
    res.json(events)
  }

  async getAnalyticsEventsCount (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // run query
    var events = await this.analytics.countEvents({
      unique: req.query.unique,
      groupBy: req.query.groupBy,
      where: `event = "${req.query.event || 'visit'}"`
    })

    // respond
    res.json(events)
  }

  async getAnalyticsEventsStats (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    var dateFilter = ''
    if (req.query.period !== 'all') {
      let param = ({
        'day': `date('now')`,
        '3days': `date('now', '-2 days')`,
        'week': `date('now', '-6 days')`,
        '2weeks': `date('now', '-13 days')`,
        'month': `date('now', '-1 month')`,
        '3months': `date('now', '-3 months')`,
        '6months': `date('now', '-6 months')`,
        'year': `date('now', '-1 year')`
      })[req.query.period]
      dateFilter = ` AND date >= ${param}`
    }

    // run queries
    var [visits, registrations, logins, upgrades, cancels] = await Promise.all([
      this.analytics.countEvents({unique: true, where: `event = 'visit'` + dateFilter}),
      this.analytics.countEvents({unique: true, where: `event = 'register'` + dateFilter}),
      this.analytics.countEvents({unique: true, where: `event = 'login'` + dateFilter}),
      this.analytics.countEvents({unique: true, where: `event = 'upgrade'` + dateFilter}),
      this.analytics.countEvents({unique: true, where: `event = 'cancel-plan'` + dateFilter})
    ])

    // respond
    res.json({visits, registrations, logins, upgrades, cancels})
  }

  async getAnalyticsCohorts (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // run query
    var counts = await this.analytics.countCohortStates('active_users')

    // massage the data structure
    var cohorts = {}
    counts.forEach(({cohort, state, count}) => {
      cohorts[cohort] = cohorts[cohort] || {}
      cohorts[cohort][state] = count
    })

    // respond
    res.json(cohorts)
  }

  async getReports (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // html requests
    if (req.accepts('html')) {
      return res.render('admin-dashboard-reports')
    }

    // fetch
    var reports
    if (req.query.view === 'dashboard') {
      // pull down all records, the client is going to handle everything
      reports = await this.reportsDB.list()
    } else {
      reports = await this.reportsDB.list({
        cursor: req.query.cursor,
        limit: req.query.limit ? +req.query.limit : 25,
        sort: req.query.sort,
        reverse: +req.query.reverse === 1
      })
    }

    // respond
    res.status(200)
    res.json({reports})
  }

  async getReport (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    // fetch
    var report = await this._getReport(req.params.id)

    // respond
    if (req.accepts('html')) {
      return res.render('admin-dashboard-report', {record: report})
    }
    res.status(200)
    res.json(report)
  }

  async updateReport (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    req.checkBody('status').optional().isAlphanumeric()
    ;(await req.getValidationResult()).throw()

    // keep a list of changes processed
    var changedFields = []

    var release = await lock('reports')
    try {
      // fetch
      var report = await this._getReport(req.params.id)

      // update
      ADMIN_MODIFIABLE_FIELDS_REPORT.forEach(key => {
        if (typeof req.body[key] !== 'undefined') {
          changedFields.push(key)
          report[key] = req.body[key]
        }
      })

      await this.reportsDB.put(report)
    } finally {
      release()
    }

    // respond
    res.status(200)
    res.json({report, changedFields})
  }

  async closeReport (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    var release = await lock('reports')
    try {
      // fetch
      var report = await this._getReport(req.params.id)

      // update
      report.status = 'closed'
      await this.reportsDB.put(report)
    } finally {
      release()
    }
    res.status(200)
    res.json({report})
  }

  async openReport (req, res) {
    // check perms
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('admin:dpacks')) throw new ForbiddenError()

    var release = await lock('reports')
    try {
      // fetch
      var report = await this._getReport(req.params.id)

      // update
      report.status = 'open'
      await this.reportsDB.put(report)
    } finally {
      release()
    }
    res.status(200)
    res.json({report})
  }

  async _getReport (id) {
    const report = this.reportsDB.getByID(id)
    if (!report) throw new NotFoundError()
    return report
  }

  async _getUser (id) {
    // try to fetch by id, username, and email
    var user = await this.usersDB.getByID(id)
    if (user) return user

    user = await this.usersDB.getByUsername(id)
    if (user) return user

    user = await this.usersDB.getByEmail(id)
    if (user) return user

    throw new NotFoundError()
  }
}
