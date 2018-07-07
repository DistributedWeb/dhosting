const {UnauthorizedError, ForbiddenError} = require('../const')

// exported api
// =

module.exports = class ReportsAPI {
  constructor (dhost) {
    this.reportsDB = dhost.reportsDB
    this.usersDB = dhost.usersDB
  }

  async add (req, res) {
    // validate session
    if (!res.locals.session) throw new UnauthorizedError()
    if (!res.locals.session.scopes.includes('user')) throw new ForbiddenError()

    // validate & sanitize input
    req.checkBody('vaultKey').isDWebHash()
    req.checkBody('vaultOwner').isAlphanumeric()
    req.checkBody('reason').isAlphanumeric()
    ;(await req.getValidationResult()).throw()

    var { vaultKey, vaultOwner, reason } = req.body

    try {
      // fetch the vault owner's record
      var vaultOwnerRecord = await this.usersDB.getByUsername(vaultOwner)
      var report = Object.assign({}, {
        vaultKey,
        vaultOwner: vaultOwnerRecord.id,
        reason,
        reportingUser: res.locals.session.id
      })

      // create the report
      await this.reportsDB.create(report)
    } catch (e) {
      return res.status(422).json({
        message: 'There were errors in your submission'
      })
    }

    // respond
    res.status(200).end()
  }
}
