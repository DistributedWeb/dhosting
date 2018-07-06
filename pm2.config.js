'use strict'
const {hostname} = require('os')
const env = 'production'
process.env.NODE_ENV = env
const config = require('./lib/config')

module.exports = {
  apps: [{
    script: './bin.js',
    name: 'dhosting',
    combine_logs: false,
    pid_file: `${config.dir}/dhosting.pid`,
    out_file: `${config.dir}/logs/dhosting_${hostname()}_out.log`,
    err_file: `${config.dir}/logs/dhosting_${hostname()}_err.log`,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: env
    }
  }]
}
