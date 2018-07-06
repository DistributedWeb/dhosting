const bytes = require('bytes')
const ms = require('ms')
const fs = require('fs')
const path = require('path')
const {du} = require('./helpers')

const GB = bytes('1gb')

module.exports.init = function (config, dhost, pmx) {
  setupHDUsageMonitor(config, pmx)
  setupVaultrMonitor(config, dhost, pmx)
  setupProfilerActions(config, pmx)
  pmx.action('compute-cohorts', async cb => {
    try {
      await dhost.usersDB.computeCohorts()
      cb({success: true}) // eslint-disable-line
    } catch (err) {
      cb({success: false, err}) // eslint-disable-line
    }
  })
}

function setupHDUsageMonitor (config, pmx) {
  var metric = pmx.probe().metric({
    name: 'Disk Usage',
    alert: {
      mode: 'threshold',
      value: bytes(config.alerts.diskUsage || '10gb') / GB,
      msg: `Detected over ${config.alerts.diskUsage} disk usage`
    }
  })

  read()
  setInterval(read, ms('15m'))
  async function read () {
    var v = await du(config.dir)
    metric.set(v / GB)
  }
}

function setupVaultrMonitor (config, dhost, pmx) {
  var connsCounter = pmx.probe().counter({name: 'Connections'})
  var connsMeter = pmx.probe().meter({name: 'Connections/s', samples: 1})
  var connCleanClosesMeter = pmx.probe().meter({name: 'ConnCleanCloses/s', samples: 1})
  var connErrsMeter = pmx.probe().meter({name: 'ConnErrors/s', samples: 1})
  dhost.vaultr.on('new-connection', () => {
    connsCounter.inc()
    connsMeter.mark()
  })
  dhost.vaultr.on('connection-errored', () => connErrsMeter.mark())
  dhost.vaultr.on('connection-closed', (info, err) => {
    if (!err) connCleanClosesMeter.mark()
    connsCounter.dec()
  })
}

function setupProfilerActions (config, pmx) {
  var isProfiling = false
  const profiler = require('v8-profiler-node8')

  pmx.action('start-profiler', cb => {
    if (isProfiling) return
    isProfiling = true

    profiler.startProfiling('dhosting-profile')

    cb({success: true}) // eslint-disable-line
  })

  pmx.action('stop-profiler', cb => {
    if (!isProfiling) return
    isProfiling = false

    const profile = profiler.stopProfiling('dhosting-profile')
    profile.export()
      .pipe(fs.createWriteStream(path.join(__dirname, '../out.cpuprofile')))
      .on('finish', function () {
        profile.delete()
        profiler.deleteAllProfiles()
        cb({success: true}) // eslint-disable-line
      })
  })

  pmx.action('take-heap-snapshot', cb => {
    var snapshot = profiler.takeSnapshot('dhosting-heap-snapshot')
    snapshot.export()
      .pipe(fs.createWriteStream(path.join(__dirname, '../out.heapsnapshot')))
      .on('finish', () => {
        snapshot.delete()
        profiler.deleteAllSnapshots()
        cb({success: true}) // eslint-disable-line
      })
  })
}
