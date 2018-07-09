const bytes = require('bytes')
const { DWEB_URL_REGEX, DWEB_KEY_REGEX, DPACK_NAME_REGEX } = require('./const')

exports.isDWebURL = value => {
  return DWEB_URL_REGEX.test(value)
}

exports.isDWebHash = value => {
  return value.length === 64 && DWEB_KEY_REGEX.test(value)
}

exports.isDWebHashOrURL = value => {
  return exports.isDWebURL(value) || exports.isDWebHash(value)
}

exports.isDWebName = value => {
  return DPACK_NAME_REGEX.test(value)
}

exports.isScopesArray = value => {
  return Array.isArray(value) && value.filter(v => typeof v !== 'string').length === 0
}

exports.isSimpleEmail = value => {
  return typeof value === 'string' && value.indexOf('+') === -1
}

exports.isPassword = value => {
  return typeof value === 'string' && value.length >= 6 && value.length <= 100
}

exports.isBytes = value => {
  return value === null || typeof value === 'number' || !!bytes(value)
}
