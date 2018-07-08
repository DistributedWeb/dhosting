const path = require('path')
const promisify = require('es6-promisify')
const through2 = require('through2')
const identifyFiletype = require('identify-filetype')
const mime = require('mime')
const getFolderSize = require('get-folder-size')
const execFile = require('child_process').execFile

// config default mimetype
mime.default_type = 'text/plain'

exports.promisify = promisify
exports.promisifyModule = function (module, methods) {
  for (var m of methods) {
    module[m] = promisify(module[m], module)
  }
}

exports.pluralize = function (num, base, suffix = 's') {
  if (num === 1) {
    return base
  }
  return base + suffix
}

exports.makeSafe = function (str) {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;').replace(/"/g, '')
}

var identify =
exports.identify = function (name, chunk) {
  // try to identify the type by the chunk contents
  var mimeType
  var identifiedExt = (chunk) ? identifyFiletype(chunk) : false
  if (identifiedExt) {
    mimeType = mime.lookup(identifiedExt)
  }
  if (!mimeType) {
    // fallback to using the entry name
    mimeType = mime.lookup(name)
  }

  // hackish fix
  // the svg test can be a bit aggressive: html pages with
  // inline svgs can be falsely interpretted as svgs
  // double check that
  if (identifiedExt === 'svg' && mime.lookup(name) === 'text/html') {
    return 'text/html'
  }

  return mimeType
}

exports.identifyStream = function (name, cb) {
  var first = true
  return through2(function (chunk, enc, cb2) {
    if (first) {
      first = false
      cb(identify(name, chunk))
    }
    this.push(chunk)
    cb2()
  })
}

exports.wait = function (ms, value) {
  return new Promise(resolve => {
    setTimeout(() => resolve(value), ms)
  })
}

exports.ucfirst = function (str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

exports.du = function (path) {
  return new Promise(resolve => {
    execFile('du', ['-s', path], (_, stdout, stderr) => {
      const size = +(stdout.split('\t')[0])
      if (isNaN(size)) {
        getFolderSize(path, (_, size) => {
          resolve(size)
        })
      } else {
        resolve(size * 1024) // multiply by 1024 because du gives kB and we want B
      }
    })
  })
}

exports.isObject = function (v) {
  return v && typeof v === 'object'
}

async function dpackIterateFiles (vault, filepath, fn) {
  var names = await dpackReaddir(vault, filepath, {cached: true})
  for (let name of names) {
    let filepath2 = path.join(filepath, name)
    let st = await dpackStat(vault, filepath2, {cached: true})
    if (st.isDirectory()) {
      await dpackIterateFiles(vault, filepath2, fn)
    } else {
      fn(st)
    }
  }
}
exports.dpackIterateFiles = dpackIterateFiles

function dpackStat (vault, filepath, opts = {}) {
  return new Promise((resolve, reject) => {
    vault.stat(filepath, opts, (err, st) => {
      if (err) reject(err)
      else resolve(st)
    })
  })
}
exports.dpackStat = dpackStat

function dpackReaddir (vault, filepath, opts = {}) {
  return new Promise((resolve, reject) => {
    vault.readdir(filepath, opts, (err, names) => {
      if (err) reject(err)
      else resolve(names)
    })
  })
}
exports.dpackReaddir = dpackReaddir

function dpackReadFile (vault, filepath, opts = {}) {
  return new Promise((resolve, reject) => {
    vault.readFile(filepath, opts, (err, names) => {
      if (err) reject(err)
      else resolve(names)
    })
  })
}
exports.dpackReadFile = dpackReadFile

function monotonicTimestamp (start) {
  var idCounter = start || 1
  return () => {
    let id = (idCounter++).toString()
    let idLen = id.length
    return '0'.repeat(16 - idLen) + id
  }
}
exports.monotonicTimestamp = monotonicTimestamp
