/* global $ */

// tabbed vaults list js
$(function () {
  [].forEach.call(document.querySelectorAll('img[data-src]'), function (img) {
    img.setAttribute('src', img.getAttribute('data-src'))
    img.onload = function () {
      img.removeAttribute('data-src')
    }
  })
  var viewButtons = $('.vaults-view-link')
  var views = $('.vaults-view')

  $('#dismiss-get-started-btn').click(function (e) {
    $('#get-started-container')[0].style.display = 'none'
  })

  viewButtons.click(function (e) {
    viewButtons.removeClass('active')
    views.removeClass('active')

    $(e.target).addClass('active')
    $(e.target.dataset.view).addClass('active')
  })
})
