# Level Database Schema

Layout and schemas of the data in the LevelDB.

## Layout

 - `main`
   - `vaults`: Map of `key => Vault object`.
   - `vaults-index`: Index of `createdAt => key`
   - `accounts`: Map of `id => Account object`.
   - `accounts-index`: Index of `username => id`, `email => id`, `profileUrl => id`.
   - `global-activity`: Map of `timestamp => Event object`.
   - `global-activity-users-index`: Set of `username:timestamp => null` for doing user filtering.
   - `dead-vaults`: Map of `key => undefined`. A listing of vaults with no hosting users, and which need to be deleted.

## Vault object

Schema:

```
{
  key: String, the vault key

  hostingUsers: Array(String), list of user-ids hosting the vault

  updatedAt: Number, the timestamp of the last update
  createdAt: Number, the timestamp of creation time
}
```

## Account object

Schema:

```
{
  id: String, the assigned id
  username: String, the chosen username
  passwordHash: String, hashed password
  passwordSalt: String, salt used on hashed password

  email: String
  pendingEmail: String, the user's new email address pending verification
  profileURL: String, the url of the profile dat
  vaults: [{
    key: String, uploaded vault's key
    name: String, optional shortname for the vault
  }, ..]
  scopes: Array(String), the user's access scopes
  suspension: String, if suspended, will be set to an explanation
  updatedAt: Number, the timestamp of the last update
  createdAt: Number, the timestamp of creation time

  isEmailVerified: Boolean
  emailVerifyNonce: String, the random verification nonce (register flow)

  forgotPasswordNonce: String, the random verification nonce (forgot password flow)

  isProfileDPackVerified: Boolean
  profileVerifyToken: String, the profile verification token (stored so the user can refetch it)
}
```

## Report object

Schema:
```
{
  id: String, the id of this report

  vaultKey: String, the vault key

  vaultOwner: String, the user ID of the vault’s owner
  reportingUser: String, the user ID of the user that reported it

  reason: String, the reason for reporting the vault
  status: String, the status of the report. Can be ‘open’ or ‘closed’
  notes: String, administrative notes on this report (used internally)

  createdAt: Number, the timestamp of the report
  updatedAt: Number, the timestamp the report was last updated
}
```

## Event object

Schema:

```
{
  ts: Number, the timestamp of the event
  userid: String, the user who made the change
  username: String, the name of the user who made the change
  action: String, the label for the action
  params: Object, a set of arbitrary KVs relevant to the action
}
```
