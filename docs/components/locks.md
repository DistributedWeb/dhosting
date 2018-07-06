# Locks Component

Locks are used internally to create regions of async code that will only be entered one at a time. Locks are necessary to coordinate multi-step changes to the level databases.

Take care to coordinate the locks across the codebase. Some lock identifiers need to be reused in multiple code regions. Be careful not to use an identifier twice in a row, without first releasing, since that will stall the request.

## Usage

```js
var lock = require('./lock')

async function foo () {
  var release = await lock('bar')
  try {
    // do work
  } finally {
    release()
  }
}
```

Be sure to always use a try/finally block.

## Locks in use

 - `users`. Must be used any time updates are made to the users DB.
 - `vaults`. Must be used any time an update is made to the vaults DB.
 - `vaultr-job`. Used to make sure only one job runs at once (to avoid overloading the thread).