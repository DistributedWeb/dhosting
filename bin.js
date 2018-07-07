require('./nodecompat')
var config = require('./lib/config')
var createApp = require('./index')
var log = require('debug')('LE')
var figures = require('figures')

async function start () {
  var app = await createApp(config)
  if (config.letsencrypt) {
    var greenlockExpress = require('greenlock-express')
    var debug = config.letsencrypt.debug !== false
    greenlockExpress.create({
      server: debug ? 'staging' : 'https://acme-staging-v02.api.letsencrypt.org/directory',
      version: 'v02',
      debug,
      approveDomains: app.approveDomains,
      app,
      log
    }).listen(80, 443)
  } else {
    app.listen(config.port, () => {
      console.log(figures.tick, `Server started on http://127.0.0.1:${config.port}`)
    })
  }
}
start()
