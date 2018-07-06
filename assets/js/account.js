/* global $ Stripe */

// account upgrade page js
$(function () {
  var updateCardForm = $('#form-card-update')

  // create stripe elements
  var stripe = Stripe(window.params.stripePK)
  var elements = stripe.elements()
  var card = elements.create('card', {style: {
    base: {
      color: '#32325d',
      lineHeight: '24px',
      fontFamily: 'Helvetica Neue',
      fontSize: '16px',
      '::placeholder': {
        color: '#aab7c4'
      }
    },
    invalid: {
      color: '#fa755a',
      iconColor: '#fa755a'
    }
  }})
  card.mount('#card-element')

  // show form
  $('#show-update-card-form').click(function () {
    updateCardForm.addClass('open')
  })

  // render errors
  card.addEventListener('change', function (e) {
    $('#card-errors').text(e.error ? e.error.message : '')
    $('#submit-btn').attr('disabled', !e.complete ? 'disabled' : null)
  })

  // form submit
  updateCardForm.on('submit', function (e) {
    e.preventDefault()

    toggleSpinner(true)
    stripe.createToken(card).then(function (result) {
      if (result.error) {
        toggleSpinner(false)
        $('#card-errors').text(result.error.message)
        return
      }

      // post to api
      var token = result.token
      var last4 = token.card.last4
      var cardImagePath = '/assets/images/cc-' + token.card.brand.toLowerCase().replace(' ', '') + '.png'

      var xhr = $.post('/v2/accounts/account/update-card', {
        _csrf: updateCardForm.find('[name=_csrf]').val(),
        token: token
      })
      xhr.done(function (res) {
        $('#billing-alert-success').text('Your payment information has been updated')
        $('#last-4').text(last4)
        $('#card-brand').attr('src', cardImagePath)
        toggleSpinner(false)
        updateCardForm.removeClass('open')
      })
      xhr.fail(function (res) {
        // failure, render errors
        toggleSpinner(false)
        try {
          var resObj = JSON.parse(res.responseText)
        } catch (e) {}
        console.error('Error', res)
        $('#card-errors').text((resObj && resObj.message) || 'Internal server error. Please contact support.')
      })
    })
  })

  function toggleSpinner (on) {
    if (on) {
      $('#submit-btn').attr('disabled', 'disabled').html('<i class="fa fa-circle-o-notch fa-spin fa-fw"></i>')
    } else {
      $('#submit-btn').attr('disabled', null).html('<i class="fa fa-arrow-circle-up"></i> Upgrade')
    }
  }
})
