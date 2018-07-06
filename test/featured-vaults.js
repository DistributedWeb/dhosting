var path = require('path')
var test = require('ava')
var createTestServer = require('./lib/server.js')
var { makeDPackFromFolder } = require('./lib/dweb.js')

var app
var sessionToken, auth
var testDPackKey

test.cb('start test server', t => {
  createTestServer(async (err, _app) => {
    t.ifError(err)
    app = _app

    // login
    var res = await app.req.post({
      uri: '/v2/accounts/login',
      json: {
        'username': 'admin',
        'password': 'foobar'
      }
    })
    if (res.statusCode !== 200) throw new Error('Failed to login as admin')
    sessionToken = res.body.sessionToken
    auth = { bearer: sessionToken }

    t.end()
  })
})

test.cb('share test-dpack', t => {
  makeDPackFromFolder(path.join(__dirname, '/scaffold/testdpack1'), (err, d, dkey) => {
    t.ifError(err)
    testDPackKey = dkey
    t.end()
  })
})

test('add vault', async t => {
  var json = {key: testDPackKey, name: 'my-dpack'}
  var res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 added dPack')
})

test.cb('check vault status and wait till synced', t => {
  var to = setTimeout(() => {
    throw new Error('Vault did not sync')
  }, 15e3)

  checkStatus()
  async function checkStatus () {
    var res = await app.req({uri: `/v2/vaults/item/${testDPackKey}`, qs: {view: 'status'}, json: true, auth})
    var progress = res.body && res.body.progress ? res.body.progress : 0
    if (progress === 1) {
      clearTimeout(to)
      console.log('synced!')
      t.end()
    } else {
      console.log('progress', progress * 100, '%')
      setTimeout(checkStatus, 300)
    }
  }
})

test('add vault to featured', async t => {
  var res = await app.req.post({uri: `/v2/admin/vaults/${testDPackKey}/feature`, auth})
  t.is(res.statusCode, 200, '200 added dPack to featured')
})

test('get populated featured', async t => {
  var res = await app.req.get({uri: '/v2/explore?view=featured', json: true})
  t.is(res.statusCode, 200, '200 got featured dpacks')
  t.is(res.body.featured.length, 1, 'got 1 vault')
  for (var i = 0; i < 1; i++) {
    let vault = res.body.featured[i]
    t.truthy(typeof vault.key === 'string', 'has key')
    t.truthy(typeof vault.numPeers === 'number', 'has numPeers')
    t.truthy(typeof vault.name === 'string', 'has name')
    t.truthy(typeof vault.title === 'string', 'has title')
    t.truthy(typeof vault.description === 'string', 'has description')
    t.truthy(typeof vault.owner === 'string', 'has owner')
    t.truthy(typeof vault.createdAt === 'number', 'has createdAt')
  }
})

test('remove vault from featured', async t => {
  var res = await app.req.post({uri: `/v2/admin/vaults/${testDPackKey}/unfeature`, auth})
  t.is(res.statusCode, 200, '200 removed dPack from featured')
})

test('get unpopulated featured', async t => {
  var res = await app.req.get({uri: '/v2/explore?view=featured', json: true})
  t.is(res.statusCode, 200, '200 got featured dpacks')
  t.is(res.body.featured.length, 0, 'got 0 vaults')
})

test.cb('stop test server', t => {
  app.close(() => {
    t.pass('closed')
    t.end()
  })
})
