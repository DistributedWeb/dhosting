# Web APIs v2 Overview

Conforms to https://www.dwebs.io/deps/pinning-service-dpacks-api.html

Service APIs

```
GET / - entry endpoint
GET /.well-known/psa - services description document
GET /v2/explore - get info about activity on the server
```

Vault APIs

```
GET /v2/users/:username/:vaultName
GET /v2/vaults
GET /v2/vaults/item/:vaultKey
POST /v2/vaults/add
POST /v2/vaults/remove
POST /v2/vaults/item/:vaultKey
```

User APIs

```
GET /v2/users/:username
POST /v2/accounts/register
GET /v2/accounts/verify
POST /v2/accounts/verify
POST /v2/accounts/login
GET /v2/accounts/logout
POST /v2/accounts/logout
GET  /v2/accounts/account - get my info & settings
POST /v2/accounts/account - update my settings
POST /v2/accounts/account/password - change my password
POST /v2/accounts/account/email - change my email
POST /v2/accounts/account/upgrade - upgrade my plan
POST /v2/accounts/account/register/pro - upgrade my plan (in the register flow)
POST /v2/accounts/account/update-card - update my card details
POST /v2/accounts/account/cancel-plan - cancel my plan
```

Admin APIs

```
GET  /v2/admin/users - query users
GET  /v2/admin/users/:id - get user info & settings
POST /v2/admin/users/:id - update user settings
POST /v2/admin/users/:id/suspend - suspend a user account
POST /v2/admin/users/:id/unsuspend - unsuspend a user account
POST /v2/admin/vaults/:key/feature - add an vault to featured
POST /v2/admin/vaults/:key/unfeature - remove an vault from featured
GET /v2/admin/vaults/:key - get vault information
POST /v2/admin/vaults/:key/remove - remove an vault
POST /v2/admin/users/:username/send-email - send an email to the user
```

## Service APIs

### GET /

Home page.

Response: TODO

### GET /.well-known/psa

Services description document. See [PSA Web Service Revelation Protocol](https://github.com/distributedweb/beaker/wiki/PSA-Web-Service-Revelation-Protocol).

### GET /v2/users/:username

Lookup user profile.

Response:

```
{
  username: String, from user's account object
  createdAt: Number, the timestamp of creation time
}
```

Response when `?view=vaults`:

```
{
  vaults: [{
    key: String, dWeb key
    name: String, optional shortname assigned by the user
    title: String, optional title extracted from the dPack's manifest file
    description: String, optional description extracted from the dPack's manifest file
  }]
}
```

Response when `?view=activity`:

```
{
  activity: [{
    key: String, event's id
    userid: String, the user who made the change
    username: String, the name of the user who made the change
    action: String, the label for the action
    params: Object, a set of arbitrary KVs relevant to the action
  }, ...]
}
```

Additional query params when `?view=activity`:

 - start: For pagination. The key of the event to start after.

### GET /v2/users/:username/:vaultname

Lookup vault info. `vaultname` can be the user-specified shortname, or the vault key.

Response:

```
{
  user: String, the owning user's name
  key: String, the key of the dPack
  name: String, optional shortname assigned by the user
  title: String, optional title extracted from the dPack's manifest file
  description: String, optional description extracted from the dPack's manifest file
}
```

### GET /v2/explore

Response body when `?view=activity`:

```
{
  activity: [{
    key: String, event's id
    userid: String, the user who made the change
    username: String, the name of the user who made the change
    action: String, the label for the action
    params: Object, a set of arbitrary KVs relevant to the action
  }, ...]
}
```

Additional query params when `?view=activity`:

 - start: For pagination. The key of the event to start after.

Response body when `?view=featured`:

```
{
  featured: [{
    key: String, the vault's key
    numPeers: Number, the number of peers replicating the vault
    name: String, the name given to the vault by its owner
    title: String, optional title extracted from the dPack's manifest file
    description: String, optional description extracted from the dPack's manifest file
    owner: String, the username of the owning author
    createdAt: Number, the timestamp of the vault's upload
  }, ...]
}
```

Response body when `?view=popular`:

```
{
  popular: [{
    key: String, the vault's key
    numPeers: Number, the number of peers replicating the vault
    name: String, the name given to the vault by its owner
    title: String, optional title extracted from the dPack's manifest file
    description: String, optional description extracted from the dPack's manifest file
    owner: String, the username of the owning author
    createdAt: Number, the timestamp of the vault's upload
  }, ...]
}
```

Additional query params when `?view=popular`:

 - start: For pagination. Should be an offset.

Response body when `?view=recent`:

```
{
  recent: [{
    key: String, the vault's key
    numPeers: Number, the number of peers replicating the vault
    name: String, the name given to the vault by its owner
    title: String, optional title extracted from the dPack's manifest file
    description: String, optional description extracted from the dPack's manifest file
    owner: String, the username of the owning author
    createdAt: Number, the timestamp of the vault's upload
  }, ...]
}
```

Additional query params when `?view=recent`:

 - start: For pagination. Should be a timestamp.

## Vault APIs

### GET /v2/vaults

List the current user's vaults.

Reponse when `Accept: application/json`:

```
{
  items: [{
    url: String, dWeb url
    name: String, optional shortname assigned by the user
    title: String, optional title extracted from the dPack's manifest file
    description: String, optional description extracted from the dPack's manifest file
    additionalUrls: Array of Strings, optional list of URLs the dPack can be accessed at
  }]
}
```

### GET /v2/vaults/item/:vaultKey

Fetch the vault info.

Reponse when `Accept: application/json`:

```
{
  url: String, dWeb url
  name: String, optional shortname assigned by the user
  title: String, optional title extracted from the dPack's manifest file
  description: String, optional description extracted from the dPack's manifest file
  additionalUrls: Array of Strings, optional list of URLs the dPack can be accessed at
}
```

Response when `?view=status` and `Accept: text/event-stream`:

 - Data event is emitted every 1000ms
 - Event contains a number, percentage (from 0 to 1) of upload progress

Response when `?view=status` and `Accept: application/json`:

```
{
  progress: Number, a percentage (from 0 to 1) of upload progress
}
```

### POST /v2/vaults/add

Request body. Can supply `key` or `url`:

```
{
  key: String
  url: String
  name: String, optional shortname for the vault
}
```

Adds the vault to the user's account. If the vault already exists, the request will update the settings (eg the name).

### POST /v2/vaults/remove

Request body. Can supply `key` or `url`:

```
{
  key: String
  url: String
}
```

Removes the vault from the user's account. If no users are hosting the vault anymore, the vault will be deleted.

### POST /v2/vaults/item/:vaultKey

Update the vault info.

Request body.

```
{
  name: String, optional shortname for the vault
}
```

## User APIs

### POST /v2/accounts/login

Request body. All fields required:

```
{
  username: String
  password: String
}
```

Generates a session JWT and provides it in response headers.

### POST /v2/accounts/register

[Step 1 of the register flow](./flows/registration.md#step-1-register-post-v1register)

Request body. All fields required:

```
{
  email: String
  username: String
  password: String
}
```

### GET|POST /v2/accounts/verify

[Step 2 of the register flow](./flows/registration.md#step-2-verify-get-or-post-v1verify)

Request body. All fields required:

```
{
  username: String, username of the account
  nonce: String, verification nonce
}
```

Like `/v2/accounts/login`, generates a session JWT and provides it in response headers.

### GET /v2/accounts/account

Responds with the authenticated user's [account object](https://docs.dhosting.io/Users-Schema#account-object).

Response body:

```
{
  email: String, the user's email address
  username: String, the chosen username
  diskUsage: Number, the number of bytes currently used by this account's accounts
  diskQuota: Number, the number of bytes allowed to be used by this account's accounts
  updatedAt: Number, the timestamp of the last update to the account
  createdAt: Number, the timestamp of when the account was created
}
```

### POST /v2/accounts/account

Updates the authenticated user's [account object](https://docs.dhosting.io/Users-Schema#account-object)

Request body:

All fields are optional. If a field is omitted, no change is made.

```
{
  username: String, the chosen username
}
```

### POST /v2/accounts/account/password

Updates the authenticated user's password.

The request body depends on whether the user authenticated.

Request body if authenticated:

```
{
  oldPassword: String
  newPassword: String
}
```

Request body if using the forgotten-password flow:

```
{
  username: String
  nonce: String
  newPassword: String
}
```

### POST /v2/accounts/account/email

Initiates a flow to update the authenticated user's email.

Request body:

```
{
  newEmail: string
  password: string
}
```

### POST /v2/accounts/account/upgrade

Validates the given payment information, starts a subscription plan with Stripe, and upgrades the authenticated user's plan.

Request body:

```
{
  token: Object, the token from Stripe
}
```

### POST /v2/accounts/account/register/pro - upgrade my plan (in the register flow)

Validates the given payment information, starts a subscription plan with Stripe, and upgrades the given user's plan. Used as part of the registration flow.

Request body:

```
{
  id: String, the user-id
  token: Object, the token from Stripe
}
```

The id may be given through the query string instead of the body.

### POST /v2/accounts/account/update-card - update my card details

Validates the given payment information and updates the subscription plan with Stripe for authenticated user.

Request body:

```
{
  token: Object, the token from Stripe
}
```

### POST /v2/accounts/account/cancel-plan

Stops the subscription plan with Stripe, and downgrades the authenticated user's plan.

## Admin APIs

### GET /v2/admin/users

Run queries against the users DB.

Query params:

 - `cursor`. Key value to start listing from.
 - `limit`. How many records to fetch.
 - `sort`. Values: `id` `username` `email`. Default `id` (which is also ordered by creation time)
 - `reverse`. Reverse the sort. (1 means true.)

Response body:

```
{
  users: [{
    email: String, the user's email address
    username: String, the chosen username
    isEmailVerified: Boolean
    scopes: Array of strings, what is this user's perms?
    diskUsage: Number, how many bytes the user is using
    diskQuota: Number, how many bytes the user is allowed
    updatedAt: Number, the timestamp of the last update
    createdAt: Number, the timestamp of creation time
  }, ...]
}
```

Scope: `admin:users`

### GET /v2/admin/users/:id

Response body:

```
{
  email: String, the user's email address
  username: String, the chosen username
  isEmailVerified: Boolean
  emailVerifyNonce: String, the random verification nonce
  scopes: Array of strings, what is this user's perms?
  diskUsage: Number, how many bytes the user is using
  diskQuota: Number, how many bytes the user is allowed
  updatedAt: Number, the timestamp of the last update
  createdAt: Number, the timestamp of creation time
}
```

Scope: `admin:users`

### POST /v2/admin/users/:id

Request body:

All fields are optional. If a field is omitted, no change is made.

```
{
  email: String, the user's email address
  username: String, the chosen username
  scopes: Array of strings, what is this user's perms?
  diskQuota: String, a description of how many bytes the user is allowed (eg '5mb')
}
```

Scope: `admin:users`

### POST /v2/admin/users/:id/suspend

Scope: `admin:users`

### POST /v2/admin/users/:id/unsuspend

Scope: `admin:users`

### POST /v2/admin/vaults/:id/feature

Scope: `admin:dpacks`

### POST /v2/admin/vaults/:id/unfeature

Scope: `admin:dpacks`

### GET /v2/admin/vaults/:key

Response body:

```
{
  key: String, vault key
  numPeers: Number, number of active peers
  manifest: Object, the vault's manifest object (dpack.json)
  flockOpts: {
    download: Boolean, is it downloading?
    upload: Boolean, is it uploading?
  }
}
```
