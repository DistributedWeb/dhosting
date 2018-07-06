/* global $ DPackVault */

var DPACK_KEY_REGEX = /([0-9a-f]{64})/i

$(function () {
  var addVaultForm = $('#add-vault-form')
  var addVaultKeyInput = $('#add-vault-key-input')
  var addVaultNameInput = $('#add-vault-name-input')
  var addVaultNameOutput = $('#add-vault-name-output')
  var addVaultNameOutputContainer = $('#add-vault-name-output-container')
  var addVaultSubmitBtn = $('#add-vault-submit-btn')
  var toggleables = $('[data-target]')

  toggleables.forEach(function (el) {
    el.addEventListener('click', toggleHowto)
  })
  setupDatPicker()
  addVaultNameOutputContainer[0].style.opacity = '0'

  function setupDatPicker () {
    if (!('DPackVault' in window)) {
      return
    }

    var dPackPicker = $('.dpack-picker')
    dPackPicker.parent().addClass('enabled')
    dPackPicker.click(onPickDPack)
  }

  function onPickDPack () {
    DPackVault.selectVault().then(vault => {
      addVaultKeyInput.val(vault.url)
    })
  }

  function toggleHowto (e) {
    var content = $(e.currentTarget.dataset.target)
    var icon = e.currentTarget.childNodes[3]

    content.toggleClass('visible')

    if (icon.classList.contains('fa-caret-right')) {
      icon.classList.remove('fa-caret-right')
      icon.classList.add('fa-caret-down')
    } else {
      icon.classList.remove('fa-caret-down')
      icon.classList.add('fa-caret-right')
    }
  }

  function getKeyVal () {
    var keyValRaw = addVaultKeyInput.val()
    var keyMatch = DPACK_KEY_REGEX.exec(keyValRaw)
    return (keyMatch) ? keyMatch[1] : false
  }

  // automatic url rendering
  addVaultKeyInput.on('keyup', onChange)
  addVaultNameInput.on('keyup', onChange)
  function onChange () {
    // extract sanitized values
    var keyVal = getKeyVal()
    var nameVal = addVaultNameInput.val()

    if (nameVal.length) {
      addVaultNameOutputContainer[0].style.opacity = 1
    } else {
      addVaultNameOutputContainer[0].style.opacity = 0
    }

    // update the name output
    if (nameVal === window.params.username) {
      addVaultNameOutput.text('')
    } else {
      addVaultNameOutput.text(nameVal || '')
    }

    // update submit button disabled state
    if (keyVal) addVaultSubmitBtn.removeAttr('disabled')
    else addVaultSubmitBtn.attr('disabled', true)

    // provide initial feedback about vault name
    if (!nameVal.match(/^([0-9a-zA-Z-]*)$/i)) {
      renderErrors({
        details: {
          name: {
            msg: 'Names must only contain characters, numbers, and dashes',
            param: 'name'
          }
        }
      })
    } else {
      $('#add-vault-name-error').text('').parent().removeClass('warning')
    }
  }

  // alter values prior to submission
  addVaultSubmitBtn.on('click', function (e) {
    e.preventDefault()
    addVaultKeyInput.val(getKeyVal())
    addVaultForm.submit()
  })

  addVaultForm.on('submit', function (e) {
    e.preventDefault()
    addVaultKeyInput.val(getKeyVal())

    // serialize form values
    var values = {}
    $(this).serializeArray().forEach(function (value) {
      values[value.name] = value.value
    })
    if (values.name === '') {
      delete values.name
    }

    // post to api
    var xhr = $.post('/v2/vaults/add', values)
    xhr.done(function (res) {
      // success, redirect
      window.location = '/' + window.params.username + '/' + (values.name || values.key)
    })
    xhr.fail(function (res) {
      // failure, render errors
      try {
        renderErrors(JSON.parse(res.responseText))
      } catch (e) {
        renderErrors(res.responseText)
      }
    })
  })

  function renderErrors (json) {
    // individual form errors
    if (json.outOfSpace) {
      $('#error-general').text(json.message)
    } else if (json.details && Object.keys(json.details).length > 0) {
      var details = json.details || {}
      ;(['key', 'name']).forEach(function (name) {
        if (details[name]) {
          $('#add-vault-' + name + '-error')
            .text(details[name].msg)
            .parent()
            .addClass('warning')
        } else {
          $('#add-vault-' + name + '-error')
            .text('')
            .parent()
            .removeClass('warning')
        }
      })
    } else {
      $('#error-general').text(json.message || 'There was an error processing your submission')
    }
  }
})
