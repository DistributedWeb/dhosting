const os = require('os')
const path = require('path')
const fs = require('fs')

exports.mktmpdir = function () {
  if (fs.mkdtempSync) {
    return fs.mkdtempSync(os.tmpdir() + path.sep + 'dhosting-test-')
  }
  var p = (os.tmpdir() + path.sep + 'dbrowser-test-' + Date.now())
  fs.mkdirSync(p)
  return p
}
