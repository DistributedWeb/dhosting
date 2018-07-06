# Triggers Component

Any file-indexing is handled by Triggers, which watch for changes to specific paths and vaults, then queue jobs automatically when a change is detected.

In some ways, Triggers are an alternative control mechanism to HTTP requests. Rather than a GET/POST, clients write and upload files which cause updates in the dHosting instance.

## Triggers API

```js
triggers.add(pathSpec, handler) // add a trigger & handler function
triggers.list()                 // list the active triggers
triggers.remove(handerId)       // remove a trigger & handler
```

The `pathSpec` may be a string or regex.

Example usage:

```js
triggers.add('/proofs/dhosting.io', (vault, entry) => {
  jobs.queue('verify-profile-dpack', { dwebUrl: vault.url })
})

triggers.add(new RegExp('/dpacks/[a-z0-9]'), (vault, entry) => {
  // ...
})
```
