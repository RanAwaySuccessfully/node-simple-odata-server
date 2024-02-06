'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * Simple regex based http router
 */

const http = require('node:http')
const { pathToRegexp } = require('path-to-regexp')

const methods = http.METHODS.map(method => method.toLowerCase())

module.exports = class Router {
  prefix
  routes = {}

  constructor (prefix) {
    this.routes = {}
    this.prefix = prefix === '/' ? '' : prefix

    methods.forEach(method => {
      this.routes[method] = []

      this[method] = (route, callback) => {
        this.routes[method].push({
          route: this.prefix + route,
          fn: callback
        })
      }
    })
  }

  handle (req, res) {
    const m = req.method.toLowerCase()

    const url = req.originalUrl || req.url
    const pathname = new URL(url, 'http://localhost/').pathname

    let match = false

    for (const i in this.routes[m]) {
      const el = this.routes[m][i]
      const keys = []
      const re = pathToRegexp(el.route, keys)
      const ex = re.exec(pathname)

      if (ex) {
        match = true
        const args = ex.slice(1).map(decode)
        req.params = {}
        for (let j = 0; j < keys.length; j++) {
          req.params[keys[j].name] = args[j]
        }

        el.fn(req, res)

        break
      }
    }

    if (!match) {
      const error = new Error('Not Found')
      error.code = 404
      throw error
    }
  }
}

function decode (val) {
  if (val) return decodeURIComponent(val)
}
