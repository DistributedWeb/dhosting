var test = require('ava')
var createTestServer = require('./lib/server.js')

var app
var sessionToken, auth, authUser
var fakeDWebKey1 = 'a'.repeat(64)
var fakeDWebKey2 = 'b'.repeat(64)

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

test('register and login bob', async t => {
  // register bob
  var res = await app.req.post({
    uri: '/v2/accounts/register',
    json: {
      email: 'bob@example.com',
      username: 'bob',
      password: 'foobar',
      passwordConfirm: 'foobar'
    }
  })
  if (res.statusCode !== 201) throw new Error('Failed to register bob user')

  // check sent mail and extract the verification nonce
  var lastMail = app.dhost.mailer.transport.sentMail.pop()
  var emailVerificationNonce = /([0-9a-f]{64})/.exec(lastMail.data.text)[0]

  // verify via GET
  res = await app.req.get({
    uri: '/v2/accounts/verify',
    qs: {
      username: 'bob',
      nonce: emailVerificationNonce
    },
    json: true
  })
  if (res.statusCode !== 200) throw new Error('Failed to verify bob user')

  // login bob
  res = await app.req.post({
    uri: '/v2/accounts/login',
    json: {
      'username': 'bob',
      'password': 'foobar'
    }
  })
  if (res.statusCode !== 200) throw new Error('Failed to login as bob')
  sessionToken = res.body.sessionToken
  authUser = { bearer: sessionToken }
})

test('do some activity', async t => {
  var res
  var json

  // add an vault as admin
  json = {key: fakeDWebKey1, name: 'fakedweb1'}
  res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 added dWeb')

  // add an vault as bob
  json = {key: fakeDWebKey2, name: 'fakedweb2'}
  res = await app.req.post({uri: '/v2/vaults/add', json, auth: authUser})
  t.is(res.statusCode, 200, '200 added dWeb')

  // remove an vault as admin
  json = {key: fakeDWebKey1}
  res = await app.req.post({uri: '/v2/vaults/remove', json, auth})
  t.is(res.statusCode, 200, '200 removed dWeb')
})

test('get global activity', async t => {
  // no offset
  var res = await app.req.get({url: '/v2/explore?view=activity', json: true})
  var start = res.body.activity[0].key
  res.body.activity.sort((a, b) => (a.username + a.action).localeCompare(b.username + b.action))
  t.is(res.statusCode, 200, '200 got activity')
  t.is(res.body.activity.length, 3)
  t.is(res.body.activity[0].action, 'add-vault')
  t.is(res.body.activity[0].params.name, 'fakedweb1')
  t.is(res.body.activity[0].params.key, fakeDWebKey1)
  t.is(res.body.activity[0].username, 'admin')
  t.is(res.body.activity[1].action, 'del-vault')
  t.is(res.body.activity[1].params.name, 'fakedweb1')
  t.is(res.body.activity[1].params.key, fakeDWebKey1)
  t.is(res.body.activity[1].username, 'admin')
  t.is(res.body.activity[2].username, 'bob')
  t.is(res.body.activity[2].action, 'add-vault')
  t.is(res.body.activity[2].params.name, 'fakedweb2')
  t.is(res.body.activity[2].params.key, fakeDWebKey2)

  // with offset
  res = await app.req.get({url: '/v2/explore', qs: {view: 'activity', start}, json: true})
  res.body.activity.sort((a, b) => a.username.localeCompare(b.username))
  t.is(res.statusCode, 200, '200 got activity')
  t.is(res.body.activity.length, 2)
  t.is(res.body.activity[0].username, 'admin')
  t.is(res.body.activity[0].action, 'add-vault')
  t.is(res.body.activity[0].params.name, 'fakedweb1')
  t.is(res.body.activity[0].params.key, fakeDWebKey1)
  t.is(res.body.activity[1].username, 'bob')
  t.is(res.body.activity[1].action, 'add-vault')
  t.is(res.body.activity[1].params.name, 'fakedweb2')
  t.is(res.body.activity[1].params.key, fakeDWebKey2)
})

test('get user activity', async t => {
  // no offset
  var res = await app.req.get({url: '/v2/users/admin?view=activity', json: true})
  t.is(res.statusCode, 200, '200 got activity')
  t.is(res.body.activity.length, 2)
  t.is(res.body.activity[0].username, 'admin')
  t.is(res.body.activity[0].action, 'del-vault')
  t.is(res.body.activity[0].params.key, fakeDWebKey1)
  t.is(res.body.activity[0].params.name, 'fakedweb1')
  t.is(res.body.activity[1].username, 'admin')
  t.is(res.body.activity[1].action, 'add-vault')
  t.is(res.body.activity[1].params.key, fakeDWebKey1)
  t.is(res.body.activity[1].params.name, 'fakedweb1')
  var start = res.body.activity[0].key

  res = await app.req.get({url: '/v2/users/bob?view=activity', json: true})
  t.is(res.statusCode, 200, '200 got activity')
  t.is(res.body.activity.length, 1)
  t.is(res.body.activity[0].username, 'bob')
  t.is(res.body.activity[0].action, 'add-vault')
  t.is(res.body.activity[0].params.key, fakeDWebKey2)
  t.is(res.body.activity[0].params.name, 'fakedweb2')

  // with offset
  res = await app.req.get({url: '/v2/users/admin', qs: {view: 'activity', start}, json: true})
  t.is(res.statusCode, 200, '200 got activity')
  t.is(res.body.activity.length, 1)
  t.is(res.body.activity[0].username, 'admin')
  t.is(res.body.activity[0].action, 'add-vault')
  t.is(res.body.activity[0].params.key, fakeDWebKey1)
  t.is(res.body.activity[0].params.name, 'fakedweb1')

  res = await app.req.get({url: '/v2/users/bob', qs: {view: 'activity', start}, json: true})
  t.is(res.statusCode, 200, '200 got activity')
  t.is(res.body.activity.length, 1)
  t.is(res.body.activity[0].username, 'bob')
  t.is(res.body.activity[0].action, 'add-vault')
  t.is(res.body.activity[0].params.key, fakeDWebKey2)
  t.is(res.body.activity[0].params.name, 'fakedweb2')
})

test('compute cohorts', async t => {
  // run the compute
  await app.dhost.usersDB.computeCohorts()

  // check the cohorts
  var counts = await app.dhost.analytics.countCohortStates('active_users')
  t.is(counts[0].state, '1')
  t.is(counts[1].state, '3')
  t.is(counts[0].count, 1)
  t.is(counts[1].count, 1)
})

test.cb('stop test server', t => {
  app.close(() => {
    t.pass('closed')
    t.end()
  })
})
