const bytes = require('bytes')
const { DWEB_KEY_REGEX } = require('./const')

exports.toDWebDomain = value => {
  return 'dweb://' + DWEB_KEY_REGEX.exec(value)[1] + '/'
}

exports.toBytes = value => {
  return bytes.parse(value)
}

exports.toLowerCase = value => value.toLowerCase()
