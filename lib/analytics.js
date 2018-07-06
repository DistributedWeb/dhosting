const mtb36 = require('monotonic-timestamp-base36')
const ms = require('ms')

// exported api
// =

module.exports.middleware = function (dhost) {
  return (req, res, next) => {
    var peaID = req.cookies['pea-id']
    if (!peaID) {
      // set analytics cookie
      peaID = mtb36()
      res.cookie('pea-id', peaID, {
        domain: dhost.config.hostname,
        httpOnly: true,
        maxAge: ms('1y'),
        sameSite: 'Lax'
      })
    }

    req.logAnalytics = function (event, extra = {}) {
      var referer = req.headers.referer
      if (referer && referer.startsWith('https://' + dhost.config.hostname)) {
        referer = null
      }
      extra.method = req.method
      extra.user = res.locals.sessionUser ? res.locals.sessionUser.username : null
      dhost.analytics.logEvent({
        event: event,
        url: req.path,
        session: peaID,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        referer,
        extra
      })
    }

    // log request
    req.logAnalytics('visit')

    next()
  }
}
