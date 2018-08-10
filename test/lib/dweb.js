const path = require('path')
const rimraf = require('rimraf')
const DPack = require('@dpack/core')
const util = require('./util')

exports.makeDPackFromFolder = function (dir, cb) {
  rimraf.sync(path.join(dir, '.dweb'))
  DPack(dir, (err, dweb) => {
    if (err) return cb(err)

    dweb.importFiles(() => {
      dweb.joinNetwork()

      var key = dweb.key.toString('hex')
      console.log('created dweb', key, 'from', dir)
      cb(null, dweb, key)
    })
  })
}

exports.downloadDPackFromFlock = function (key, { timeout = 5e3 }, cb) {
  var dir = util.mktmpdir()
  DPack(dir, {key}, (err, dweb) => {
    if (err) return cb(err)

    dweb.joinNetwork()
    dweb.network.once('connection', (...args) => {
      console.log('got connection')
    })

    dweb.vault.metadata.on('download', (index, block) => {
      console.log('meta download event', index)
    })

    var to = setTimeout(() => cb(new Error('timed out waiting for download')), timeout)
    dweb.vault.metadata.on('sync', () => {
      console.log('meta download finished')
    })
    dweb.vault.once('content', () => {
      console.log('opened')
      dweb.vault.content.on('download', (index, block) => {
        console.log('content download event', index)
      })
      dweb.vault.content.on('sync', () => {
        console.log('content download finished')
        clearTimeout(to)
        dweb.close()
        cb(null, dweb, key)
      })
    })
  })
}
