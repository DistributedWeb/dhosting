## UsersDB

Emits:

```js
usersDB.on('create', (record) => {})
usersDB.on('put', (record) => {})
usersDB.on('del', (record) => {})
usersDB.on('add-vault', ({userId, vaultKey, name}, record) => {})
usersDB.on('remove-vault', ({userId, vaultKey}, record) => {})
```

## VaultsDB

```js
vaultsDB.emit('create', (record) => {})
vaultsDB.emit('put', (record) => {})
vaultsDB.emit('del', (record) => {})
vaultsDB.emit('add-hosting-user', ({key, userId}, record) => {})
vaultsDB.emit('remove-hosting-user', ({key, userId}, record) => {})
```