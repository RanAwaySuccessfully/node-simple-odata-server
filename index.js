'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * Simple OData server with adapters for mongodb and lowdb
 */

const ODataServer = require('./lib/server.js')

module.exports = function (options) {
  return new ODataServer(options)
}
