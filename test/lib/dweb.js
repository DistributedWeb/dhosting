const path = require('path')
const rimraf = require('rimraf')
const DPack = require('@dpack/core')
const util = require('./util')

exports.makeDPackFromFolder = function (dir, cb) {
  rimraf.sync(path.join(dir, '.dpack'))
  DPack(dir, (err, dpack) => {
    if (err) return cb(err)

    dpack.importFiles(() => {
      dpack.joinNetwork()

      var key = dpack.key.toString('hex')
      console.log('created dPack', key, 'from', dir)
      cb(null, dpack, key)
    })
  })
}

exports.downloadDPackFromFlock = function (key, { timeout = 5e3 }, cb) {
  var dir = util.mktmpdir()
  DPack(dir, {key}, (err, dpack) => {
    if (err) return cb(err)

    dpack.joinNetwork()
    dpack.network.once('connection', (...args) => {
      console.log('got connection')
    })

    dpack.vault.metadata.on('download', (index, block) => {
      console.log('meta download event', index)
    })

    var to = setTimeout(() => cb(new Error('timed out waiting for download')), timeout)
    dpack.vault.metadata.on('sync', () => {
      console.log('meta download finished')
    })
    dpack.vault.once('content', () => {
      console.log('opened')
      dpack.vault.content.on('download', (index, block) => {
        console.log('content download event', index)
      })
      dpack.vault.content.on('sync', () => {
        console.log('content download finished')
        clearTimeout(to)
        dpack.close()
        cb(null, dpack, key)
      })
    })
  })
}
