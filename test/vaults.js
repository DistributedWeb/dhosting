var test = require('ava')
var path = require('path')
var fs = require('fs')
var promisify = require('es6-promisify')
var createTestServer = require('./lib/server.js')
var { makeDPackFromFolder, downloadDPackFromFlock } = require('./lib/dweb.js')

var app
var sessionToken, auth, authUser
var testDPack, testDPackKey
var fsstat = promisify(fs.stat, fs)

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

test.cb('share test-dpack', t => {
  makeDPackFromFolder(path.join(__dirname, '/scaffold/testdpack1'), (err, d, dkey) => {
    t.ifError(err)
    testDPack = d
    testDPackKey = dkey
    t.end()
  })
})

test('user disk usage is zero', async t => {
  var res = await app.req.get({url: '/v2/accounts/account', json: true, auth})
  t.is(res.statusCode, 200, '200 got account data')
  t.deepEqual(res.body.diskUsage, 0, 'disk usage is zero')
})

test('add vault', async t => {
  var json = {key: testDPackKey}
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

test('read back vault', async t => {
  var res = await app.req.get({url: '/v2/users/admin?view=vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got user data')
  t.deepEqual(res.body.vaults[0], {
    key: testDPackKey,
    name: null,
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data')
  t.deepEqual(res.body, {
    user: 'admin',
    key: testDPackKey,
    name: null,
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/vaults/item/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data')
  t.deepEqual(res.body, {
    url: `dweb://${testDPackKey}`,
    name: null,
    title: 'Test dPack 1',
    description: 'The first test dPack',
    additionalUrls: []
  })

  res = await app.req.get({url: '/v2/vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data')
  t.deepEqual(res.body.items[0], {
    url: `dweb://${testDPackKey}`,
    name: null,
    title: 'Test dPack 1',
    description: 'The first test dPack',
    additionalUrls: []
  })
})

test('user disk usage is now non-zero', async t => {
  // run usage-compute job
  await app.dhost.vaultr.computeAllUserDiskUsageAndFlock()

  // check data
  var res = await app.req.get({url: '/v2/accounts/account', json: true, auth})
  t.is(res.statusCode, 200, '200 got account data')
  t.truthy(res.body.diskUsage > 0, 'disk usage is greater than zero')
})

// TEMPORARY - hypercloud only allows one hosting user per vault
// test('add duplicate vault as another user', async t => {
//   var json = {key: testDPackKey}
//   var res = await app.req.post({uri: '/v2/vaults/add', json, auth: authUser})
//   t.is(res.statusCode, 200, '200 added dPack')

//   res = await app.req.get({url: '/v2/users/bob?view=vaults', json: true, auth: authUser})
//   t.is(res.statusCode, 200, '200 got user data')
//   t.deepEqual(res.body.vaults[0], {
//     key: testDPackKey,
//     name: null,
//     title: 'Test dPack 1',
//     description: 'The first test dPack'
//   })

//   res = await app.req.get({url: '/v2/users/bob/' + testDPackKey, json: true, auth: authUser})
//   t.is(res.statusCode, 200, '200 got dPack data')
//   t.deepEqual(res.body, {
//     user: 'bob',
//     key: testDPackKey,
//     name: null,
//     title: 'Test dPack 1',
//     description: 'The first test dPack'
//   })
// })
test('dont allow duplicate vaults as another user', async t => {
  var json = {key: testDPackKey}
  var res = await app.req.post({uri: '/v2/vaults/add', json, auth: authUser})
  t.is(res.statusCode, 422, '422 rejected')
})

test('add vault that was already added', async t => {
  var json = {key: testDPackKey}
  var res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 added dPack')

  res = await app.req.get({url: '/v2/users/admin?view=vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got user data')
  t.deepEqual(res.body.vaults[0], {
    key: testDPackKey,
    name: null,
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data')
  t.deepEqual(res.body, {
    user: 'admin',
    key: testDPackKey,
    name: null,
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })
})

test('change vault name', async t => {
  // change name the first time
  var json = {key: testDPackKey, name: 'test-vault'}
  var res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 added dPack')

  res = await app.req.get({url: '/v2/users/admin?view=vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got user data')
  t.deepEqual(res.body.vaults[0], {
    key: testDPackKey,
    name: 'test-vault',
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/test-vault', json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data by name')
  t.deepEqual(res.body, {
    user: 'admin',
    key: testDPackKey,
    name: 'test-vault',
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data by key')
  t.deepEqual(res.body, {
    user: 'admin',
    key: testDPackKey,
    name: 'test-vault',
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/vaults/item/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data')
  t.deepEqual(res.body, {
    url: `dweb://${testDPackKey}`,
    name: 'test-vault',
    title: 'Test dPack 1',
    description: 'The first test dPack',
    additionalUrls: ['dweb://test-vault.test.local', 'https://test-vault.test.local']
  })

  res = await app.req.get({url: '/v2/vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data')
  t.deepEqual(res.body.items[0], {
    url: `dweb://${testDPackKey}`,
    name: 'test-vault',
    title: 'Test dPack 1',
    description: 'The first test dPack',
    additionalUrls: ['dweb://test-vault.test.local', 'https://test-vault.test.local']
  })

  // change to invalid names
  json = {key: testDPackKey, name: 'invalid$name'}
  res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 422, '422 invalid name')

  // change name the second time
  json = {key: testDPackKey, name: 'test--dpack'}
  res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 added dPack')

  res = await app.req.get({url: '/v2/users/admin?view=vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got user data')
  t.deepEqual(res.body.vaults[0], {
    key: testDPackKey,
    name: 'test--dpack',
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/test--dpack', json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data by name')
  t.deepEqual(res.body, {
    user: 'admin',
    key: testDPackKey,
    name: 'test--dpack',
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 200, '200 got dPack data by key')
  t.deepEqual(res.body, {
    user: 'admin',
    key: testDPackKey,
    name: 'test--dpack',
    title: 'Test dPack 1',
    description: 'The first test dPack'
  })

  res = await app.req.get({url: '/v2/users/admin/test-vault', json: true, auth})
  t.is(res.statusCode, 404, '404 old name not found')
})

test('dont allow two vaults with same name', async t => {
  var key = 'b'.repeat(64)
  var key2 = 'c'.repeat(64)

  // add vault
  var json = {key, name: 'test-duplicate-vault'}
  var res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 added dPack')

  // add the vault again (no change)
  res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 200, '200 no change')

  // add a reserved name (fail)
  json = {key, name: 'reserved'}
  res = await app.req.post({uri: '/v2/vaults/add', json, auth})
  t.is(res.statusCode, 422, '422 name already in use')

  // add as a different user (fail)
  json = {key: key2, name: 'test-duplicate-vault'}
  res = await app.req.post({uri: '/v2/vaults/add', json, auth: authUser})
  t.is(res.statusCode, 422, '422 name already in use')

  // rename to self (no change)
  json = {name: 'test-duplicate-vault'}
  res = await app.req.post({uri: '/v2/vaults/item/' + key, json, auth})
  t.is(res.statusCode, 200, '200 can rename to self')

  // rename to existing (fail)
  json = {name: 'test--dpack'}
  res = await app.req.post({uri: '/v2/vaults/item/' + key, json, auth})
  t.is(res.statusCode, 422, '422 name already in use')

  // rename to reserved (no change)
  json = {name: 'reserved'}
  res = await app.req.post({uri: '/v2/vaults/item/' + key, json, auth})
  t.is(res.statusCode, 422, '422 name already in use')

  // remove the vault
  json = {key}
  res = await app.req.post({uri: '/v2/vaults/remove', json, auth})
  t.is(res.statusCode, 200, '200 removed')
})

test.cb('vault is accessable via dPack flock', t => {
  console.log('closing origin testdpack flock')
  testDPack.close(() => {
    console.log('downloading from server flock')
    downloadDPackFromFlock(testDPackKey, { timeout: 15e3 }, (err, receivedDPack) => {
      t.ifError(err)
      t.is(testDPack.vault.content.blocks, receivedDPack.vault.content.blocks, 'got all content blocks')
      t.end()
    })
  })
})

test('list vaults by popularity', async t => {
  // manually compute popular index
  app.dhost.vaultr.computePopularIndex()

  var res = await app.req.get({uri: '/v2/explore?view=popular', json: true})
  t.is(res.statusCode, 200, '200 got popular')
  t.is(res.body.popular.length, 1, 'got 1 vault')
  for (var i = 0; i < 1; i++) {
    let vault = res.body.popular[i]
    t.truthy(typeof vault.key === 'string', 'has key')
    t.truthy(typeof vault.numPeers === 'number', 'has numPeers')
    t.truthy(typeof vault.name === 'string', 'has name')
    t.truthy(typeof vault.title === 'string', 'has title')
    t.truthy(typeof vault.description === 'string', 'has description')
    t.truthy(typeof vault.owner === 'string', 'has owner')
    t.truthy(typeof vault.createdAt === 'number', 'has createdAt')
  }
})

test('list vaults by recency', async t => {
  var res = await app.req.get({uri: '/v2/explore?view=recent', json: true})
  t.is(res.statusCode, 200, '200 got recent')
  t.is(res.body.recent.length, 1, 'got 1 vault')
  for (var i = 0; i < 1; i++) {
    let vault = res.body.recent[i]
    t.truthy(typeof vault.key === 'string', 'has key')
    t.truthy(typeof vault.numPeers === 'number', 'has numPeers')
    t.truthy(typeof vault.name === 'string', 'has name')
    t.truthy(typeof vault.title === 'string', 'has title')
    t.truthy(typeof vault.description === 'string', 'has description')
    t.truthy(typeof vault.owner === 'string', 'has owner')
    t.truthy(typeof vault.createdAt === 'number', 'has createdAt')
  }
})

test('remove vault', async t => {
  var json = {key: testDPackKey}
  var res = await app.req.post({uri: '/v2/vaults/remove', json, auth})
  t.is(res.statusCode, 200, '200 removed dPack')
})

// TEMPORARY only 1 owner per vault allowed
// test('check vault status after removed by one user, not all', async t => {
//   var res = await app.req({uri: `/v2/vaults/item/${testDPackKey}`, qs: {view: 'status'}, auth})
//   t.is(res.statusCode, 200, '200 got dPack')
// })

// test('remove vault as other user', async t => {
//   var json = {key: testDPackKey}
//   var res = await app.req.post({uri: '/v2/vaults/remove', json, auth: authUser})
//   t.is(res.statusCode, 200, '200 removed dPack')
// })

test('remove vault that was already removed', async t => {
  var json = {key: testDPackKey}
  var res = await app.req.post({uri: '/v2/vaults/remove', json, auth})
  t.is(res.statusCode, 200, '200 removed dPack')
})

test('check vault status after removed', async t => {
  var res = await app.req({uri: `/v2/vaults/item/${testDPackKey}`, qs: {view: 'status'}, auth})
  t.is(res.statusCode, 404, '404 not found')

  res = await app.req.get({url: '/v2/users/admin?view=vaults', json: true, auth})
  t.is(res.statusCode, 200, '200 got user data')
  t.is(res.body.vaults.length, 0)

  res = await app.req.get({url: '/v2/users/admin/' + testDPackKey, json: true, auth})
  t.is(res.statusCode, 404, '404 not found')

  res = await app.req.get({url: '/v2/users/admin/testdpack', json: true, auth})
  t.is(res.statusCode, 404, '404 not found')
})

test('delete dead vaults job', async t => {
  // folder exists
  var stat = await fsstat(app.dhost.vaultr._getVaultFilesPath(testDPackKey))
  t.truthy(stat)

  // run job
  await app.dhost.vaultr.deleteDeadVaults()

  // folder does not exist
  await t.throws(fsstat(app.dhost.vaultr._getVaultFilesPath(testDPackKey)))
})

test('vault status wont stall on vault that fails to sync', async t => {
  // add a fake vault
  var fakeKey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  var json = {key: fakeKey}
  var res = await app.req({uri: '/v2/vaults/add', method: 'POST', json, auth})
  t.same(res.statusCode, 200, '200 status')

  // now ask for the status. since the vault is never found, this should timeout
  res = await app.req({uri: `/v2/vaults/item/${fakeKey}`, qs: {view: 'status'}})
  t.ok(res.statusCode === 200 || res.statusCode === 404, '200 or 404 status')
})

test.cb('stop test server', t => {
  app.close(() => {
    testDPack.close(() => {
      t.pass('closed')
      t.end()
    })
  })
})
