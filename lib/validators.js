const bytes = require('bytes')
const { DWEB_URL_REGEX, DPACK_KEY_REGEX, DPACK_NAME_REGEX } = require('./const')

exports.isDatURL = value => {
  return DWEB_URL_REGEX.test(value)
}

exports.isDatHash = value => {
  return value.length === 64 && DPACK_KEY_REGEX.test(value)
}

exports.isDatHashOrURL = value => {
  return exports.isDatURL(value) || exports.isDatHash(value)
}

exports.isDatName = value => {
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
