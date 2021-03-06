const path = require('path')
const {pluralize, makeSafe} = require('../helpers')
const {stat, readdir} = require('@dpack/api')

exports = module.exports = renderDirectoryListingPageHtml
exports.html = renderDirectoryListingPageHtml
exports.json = renderDirectoryListingPageJson
exports.text = renderDirectoryListingPageText

const styles = `<style>
  .entry {
    background: no-repeat center left;
    padding: 3px 20px;
    font-family: monospace;
  }
  .updog {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAKxJREFUeNpi/P//PwMlgImBQjAMDGBBF2BkZISz09LSwCE8a9YsuCBGoIMEkDEMJCUl/b90+QoYg9i41LNgc1ZycvL/hMQkhgcPH4H5iUnJIJf9nzt3LiNBL2RkZPwPj4hk4BMUYuDh44MEFDMLQ0xsHAMrKyvIJYyEwuDLiuXLeP7+/Qv3EihcmJmZGZiYmL5gqEcPFKBiAyDFjCPQ/wLVX8BrwGhSJh0ABBgAsetR5KBfw9EAAAAASUVORK5CYII=');
  }
  .directory {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACl0RVh0RGVzY3JpcHRpb24AQmFzZWQgb2YgSmFrdWIgU3RlaW5lciBkZXNpZ26ghAVzAAABbElEQVQ4jaWQO0tDQRCFz2x2A8YHQoogaKFW2qSysbATsdAIWgrWlhIFBRvLoFhZW/gb0vgPRBAStEgExZA2VR7X3Nw7MxY3BhUjCU6zMOz5zrcL/HPo/HDzREFnZMj1tgoI1FPm/ePL/M2fgNxRxltaXh8xxkCEoSIQYQQdH6XHO6/T8ZePL/PFfgBLCifCqJQfesswDNBoNhAEnQQRFXLZjV+qAefiRQsAba/e27MIWl4Ta1t7SE3N9lVXEVxfnaYtyJjS0z04DCMlF8fK6jaSyRQatUpfwFhypvsEUrOze4CxiUmoAlBF4LfwXq/1DUcG3UJhRmJ0HI1a9c/AzxGOAAYApEsbCiBfAMrDA5T5nwb8zYCHN/j8RABQFYAINGgYgEhUamPGKLOQiyciCFH3NABRdFsFqhoVqUJV4bebiBmjNmZd8eW5kJ6bXxhUAADw9lpWY12BLrKZRWNjt0EYTA8DsM5Vw7a/9gEhN65EVGzVRQAAAABJRU5ErkJggg==');
  }
  .file {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAASdEVYdFRpdGxlAFBhcGVyIFNoZWV0c7mvkfkAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACd0RVh0RGVzY3JpcHRpb24Ad2l0aCBhIEhVR0UgaGVscCBmcm9tIEpha3VihlQHswAAAhNJREFUOI11kstqU1EUhr91ctI2A2uTNsRaOxDEkeILiIgTL6CCAx+iUnTSgQPBRxAFSxWhA8XiBQst7aQjUV+kMWlzOaeJVZvsy3JwctK0wQWLvQabb/3/v7eoKuubqzdFZMk5PwuKqqIKoAB/Qba8d8/v3b2/xfFSVVbXPpWbUUO990Pd7Xa0Uv2paxurf1Y+vnucwA87AOh0OjP5iQL7v/dptWOacZ1ao0plZ5vdepV2q8Wt67dzxanik7fvlxcGBQQAxlgAqpUK5e0KO5Ua9d2IuNlmL/pFuVwhCAKuXrmWGx0Ze/pm+dXlFBAmAANAYSqPcy5p73DO4pwjE8OHzyuMZXNcvHAp9/3H1wXgWx9gjQGURi3CWjuU01S+xMkTBbxYgiCQg4ODGy9ePsvMzz1yfQUKTBTGcc7iVVHv8T5V4hhhFJExzp09z8bmesarzwIpINkaN1s454YUpCWBkC706gcysEkG+clxnPNo7y/0PsMhQHoAa1CvwyFCQBAoipBcFY4eyWCtxTt/FCBAHO3h7P8tZMIMpeI0xlh8z+pABkLpVBG0J1UGVKQKVBARrDH9rAaeERq1iG63298YhiFnZmf63rWXiTEGd9wCwOmZaUTkaA8ooJfpEEBEqnEcTRcKk//1n1a73QIkMtZ0EluqzD98cCfMhoum2y2pgpI84fEZlGx2pG6MmVtafP0F4B+wR1eZMTEGTgAAAABJRU5ErkJggg==');
  }
</style>`

async function getEntries (vault, dirPath) {
  // list files
  var names = []
  try { names = await readdir(vault, dirPath) } catch (e) {}

  // stat each file
  var entries = await Promise.all(names.map(async (name) => {
    var entry
    var entryPath = path.join(dirPath, name)
    try { entry = await stat(vault, entryPath) } catch (e) { return false }
    entry.path = entryPath
    entry.name = name
    return entry
  }))
  entries = entries.filter(Boolean)

  // sort the listing
  entries.sort(sortEntries)

  return entries
}

function sortEntries (a, b) {
  // directories on top
  if (a.isDirectory() && !b.isDirectory()) return -1
  if (!a.isDirectory() && b.isDirectory()) return 1
  // alphabetical after that
  return a.name.localeCompare(b.name)
}

async function renderDirectoryListingPageHtml (vault, dirPath) {
  var entries = await getEntries(vault, dirPath)

  // show the updog if path is not top
  var updog = ''
  if (dirPath !== '/' && dirPath !== '') {
    updog = `<div class="entry updog"><a href="..">..</a></div>`
  }

  // render entries
  var totalFiles = 0
  entries = entries.map(entry => {
    totalFiles++
    var url = makeSafe(entry.path)
    if (!url.startsWith('/')) url = '/' + url // all urls should have a leading slash
    if (entry.isDirectory() && !url.endsWith('/')) url += '/' // all dirs should have a trailing slash
    var type = entry.isDirectory() ? 'directory' : 'file'
    return `<div class="entry ${type}"><a href="${url}">${makeSafe(entry.name)}</a></div>`
  }).join('')

  // render summary
  var summary = `<div class="entry">${totalFiles} ${pluralize(totalFiles, 'file')}</div>`

  // render final
  return '<meta charset="UTF-8">' + styles + updog + entries + summary + '\n'
}

async function renderDirectoryListingPageJson (vault, dirPath) {
  var entries = await getEntries(vault, dirPath)

  var list = []

  // render entries
  entries.forEach(entry => {
    var path = entry.path
    var type = entry.isDirectory() ? 'directory' : 'file'
    if (type === 'directory') path += '/'
    let item = {
      path,
      name: entry.name,
      type,
      mtime: entry.mtime.getTime()
    }
    if (type === 'file') {
      item.size = entry.size
      item.blocks = entry.blocks
      item.downloaded = entry.downloaded
    }
    list.push(item)
  })
  return JSON.stringify(list, null, 2) + '\n'
}

async function renderDirectoryListingPageText (vault, dirPath) {
  var entries = await getEntries(vault, dirPath)

  var text = ''

  // render entries
  entries.forEach(entry => {
    var name = entry.name
    if (entry.isDirectory()) name += '/'
    text += name + '\n'
  })
  return text
}
