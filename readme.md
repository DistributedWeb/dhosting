# dHosting

dHosting is a public peer service for [dPack](https://dpack.io) vaults. It provides a HTTP-accessible interface for creating an account and uploading DPacks. It was created to power a content-community for the [dBrowser](https://dbrowser.io)

Links:

 - **[dHosting.io](https://dhosting.io)**
 - **[Documentation](./docs)**

## Setup

Clone this repository, then run

```
npm install
cp config.defaults.yml config.development.yml
```

Modify `config.development.yml` to fit your needs, then start the server with `npm start`.

## Configuration

Before deploying the service, you absolutely *must* modify the following config.

#### Basics

```yaml
dir: ./.dhosting              # where to store the data
brandname: dHosting           # the title of your service
hostname: dhosting.local      # the hostname of your service
proxy: true                   # is there a reverse proxy (eg nginx) in front of the server?
port: 8080                    # the port to run the service on
rateLimiting: true            # rate limit the HTTP requests?
csrf: true                    # use csrf tokens?
defaultDiskUsageLimit: 100mb  # default maximum disk usage for each user
defaultNamedVaultsLimit: 25 # how many names can a user take?
```

#### Lets Encrypt

You can enable lets-encrypt to automatically provision TLS certs using this config:

```yaml
letsencrypt:
  debug: false          # debug mode? must be set to 'false' to use live config
  email: 'foo@bar.com'  # email to register domains under
```

If enabled, `port` will be ignored and the server will register at ports 80 and 443.

#### Admin Account

The admin user has its credentials set by the config yaml at load. If you change the password while the server is running, then restart the server, the password will be reset to whatever is in the config.

```yaml
admin:
  email: 'foo@bar.com'
  password: myverysecretpassword
```

#### HTTP Sites

dHosting can host the vaults as HTTP sites. This has the added benefit of enabling [dweb-dns shortnames](https://npm.im/dweb-dns) for the vaults.

```yaml
sites: per-vault
```

This will host vaults at `vaultname.hostname`. By default, HTTP Sites are disabled.

#### Closed Registration

For a private instance, use closed registration with a whitelist of allowed emails:

```yaml
registration:
  open: false
  allowed:
    - alice@mail.com
    - bob@mail.com
```

#### Reserved Usernames

Use reserved usernames to blacklist usernames which collide with frontend routes, or which might be used maliciously.

```yaml
registration:
  reservedNames:
    - admin
    - root
    - support
    - noreply
    - users
    - vaults
```

#### Monitoring

```yaml
pm2: false         # set to true if you're using https://keymetrics.io/
alerts:
  diskUsage: 10gb  # when to trigger an alert on disk usage
```

#### Session Tokens

dHosting uses Json Web Tokens to manage sessions. You absolutely *must* replace the `secret` with a random string before deployment.

```yaml
sessions:
  algorithm: HS256                # probably dont update this
  secret: THIS MUST BE REPLACED!  # put something random here
  expiresIn: 1h                   # how long do sessions live?
```

#### Jobs

dHosting runs some jobs periodically. You can configure how frequently they run.

```yaml
# processing jobs
jobs:
  popularVaultsIndex: 30s  # compute the index of vaults sorted by num peers
  userDiskUsage: 5m          # compute how much disk space each user is using
  deleteDeadVaults: 5m     # delete removed vaults from disk
```

#### Cache sizes (advanced)

You can tweak dhosting's memory usage to trade speed against memory usage.

```yaml
# cache settings
cache:
  metadataStorage: 65536   # number of memory slots
  contentStorage: 65536    # number of memory slots
  tree: 65536              # number of memory slots
```

#### Emailer

dHosting relies on [NodeMailer](https://nodemailer.com/about/) to send out mails _(for example: required to verify a new user)_. The `email` property of the configuration will be passed _as-is_ to NodeMailer.

In the [default configuration](./config.defaults.yml#L46-L49) we use the [`stub`](https://www.npmjs.com/package/nodemailer-stub) transport which [offers a code API for tests](https://github.com/LimeDeck/nodemailer-stub/blob/8f03f86828de75ee2ccc32b98c8bc3d78e6abb00/lib/stubTransport.js#L44-L46).

```yaml
# email settings
email:
  transport: stub
  sender: '"dHosting" <noreply@dhosting.io>'
```

`dhosting` has a dependency on the [`ses`](https://www.npmjs.com/package/nodemailer-ses-transport) and [`smtp`](https://www.npmjs.com/package/nodemailer-smtp-transport) transport, which means you can use those out-of-the-box. For other transports you need to install those first.

## Tests

Run the tests with

```
npm test
```

To run the tests against a running server, specify the env var:

```
REMOTE_URL=http://{hostname}/ npm test
```

## License

MIT
