const bytes = require('bytes')
const { DPACK_KEY_REGEX } = require('./const')

exports.toDWebDomain = value => {
  return 'dweb://' + DPACK_KEY_REGEX.exec(value)[1] + '/'
}

exports.toBytes = value => {
  return bytes.parse(value)
}

exports.toLowerCase = value => value.toLowerCase()
