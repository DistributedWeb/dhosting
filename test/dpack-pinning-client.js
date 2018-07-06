const test = require('ava')
const {createClient} = require('@dpack/pin')
const createTestServer = require('./lib/server.js')

var app

test.cb('start test server', t => {
  createTestServer(async (err, _app) => {
    t.ifError(err)
    app = _app

    t.pass('started')
    t.end()
  })
})

test.cb('login fails on wrong username or password', t => {
  createClient(app.url, (err, client) => {
    if (err) throw err

    // wrong password fails
    client.login('admin', 'wrongpass', err => {
      t.truthy(err)
      t.deepEqual(err.statusCode, 422)

      t.end()
    })
  })
})

test.cb('can get account info', t => {
  createClient(app.url, {username: 'admin', password: 'foobar'}, (err, client) => {
    if (err) throw err
    t.truthy(client.hasSession)

    // can get account info
    client.getAccount((err, res) => {
      if (err) throw err
      t.deepEqual(res.username, 'admin')

      // can list dpacks
      client.listDPacks((err, res) => {
        if (err) throw err
        t.deepEqual(res.items, [])

        // logout
        client.logout(err => {
          if (err) throw err
          t.falsy(client.hasSession)

          t.end()
        })
      })
    })
  })
})

test.cb('add & remove dpacks', t => {
  createClient(app.url, {username: 'admin', password: 'foobar'}, (err, client) => {
    if (err) throw err
    t.truthy(client.hasSession)

    // add dPack
    client.addDPack({
      url: 'dweb://868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f',
      name: 'mysite'
    }, (err) => {
      if (err) throw err

      // get dPack (verify)
      client.getDPack('868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f', (err, res) => {
        if (err) throw err
        t.deepEqual(res, {
          url: 'dweb://868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f',
          name: 'mysite',
          title: '',
          description: '',
          additionalUrls: [
            'dweb://mysite.test.local',
            'https://mysite.test.local'
          ]
        })

        // update dPack
        client.updateDPack('868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f', {
          name: 'my-site'
        }, (err) => {
          if (err) throw err

          // get dPack (verify)
          client.getDPack('868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f', (err, res) => {
            if (err) throw err
            t.deepEqual(res, {
              url: 'dweb://868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f',
              name: 'my-site',
              title: '',
              description: '',
              additionalUrls: [
                'dweb://my-site.test.local',
                'https://my-site.test.local'
              ]
            })

            // list dpacks
            client.listDPacks((err, res) => {
              if (err) throw err
              t.deepEqual(res.items, [
                {
                  url: 'dweb://868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f',
                  name: 'my-site',
                  title: '',
                  description: '',
                  additionalUrls: [
                    'dweb://my-site.test.local',
                    'https://my-site.test.local'
                  ]
                }
              ])

              // remove dPack
              client.removeDPack('868d6000f330f6967f06b3ee2a03811efc23591afe0d344cc7f8c5fb3b4ac91f', err => {
                if (err) throw err

                // list dpacks
                client.listDPacks((err, res) => {
                  if (err) throw err
                  t.deepEqual(res.items, [])

                  t.end()
                })
              })
            })
          })
        })
      })
    })
  })
})

test.cb('stop test server', t => {
  app.close(() => {
    t.pass('closed')
    t.end()
  })
})
