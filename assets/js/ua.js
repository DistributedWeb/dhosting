/* global $ navigator localStorage */

// ua js
$(function () {
  var dBrowserPrompts = $('.dbrowser-prompt')
  var usingBeaker = navigator && navigator.userAgent.includes('BeakerBrowser')

  if (!usingBeaker && localStorage.hasDismissedBeakerPrompt !== '1') {
    Array.from(dBrowserPrompts).forEach(function (el) {
      el.classList.remove('hidden')
      $(el).click(function (e) {
        el.style.display = 'none'
        localStorage.hasDismissedBeakerPrompt = 1
      })
    })
  }
})
