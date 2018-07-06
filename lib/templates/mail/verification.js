exports.subject = function () {
  return 'Verify your email address'
}

exports.text = function (params) {
  return `
    \n
    Welcome, ${params.username}, to ${params.brandname}.\n
    \n
    To verify your account, follow this link:\n
    \n
    ${params.emailVerificationLink}\n
    \n
    \n
  `
}

exports.html = function (params) {
  return `
    <h1>Welcome, ${params.username}, to ${params.brandname}.</h1>
    <p>To verify your account, follow this link:</p>
    <h3><a href="${params.emailVerificationLink}" title="Verify account">${params.emailVerificationLink}</a></h3>
  `
}
