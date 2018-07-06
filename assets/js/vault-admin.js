/* global $ params */

// admin tools on vault
$(function () {
  $('#admin-remove-vault').on('click', function () {
    if (window.confirm('Remove this vault?')) {
      $.post('/v2/admin/vaults/' + params.key + '/remove', {key: params.key}, function (response, status) {
        if (status !== 'success') {
          console.error(status, response)
        }
        window.location = '/' + params.owner
      })
    } else {

    }
  })

  $('#admin-toggle-featured').click(function () {
    var act = params.isFeatured ? 'unfeature' : 'feature'
    $.post('/v2/admin/vaults/' + params.key + '/' + act, {}, function (response, status) {
      if (status !== 'success') {
        return console.error(status, response)
      }
      window.location.reload()
    })
  })
})
