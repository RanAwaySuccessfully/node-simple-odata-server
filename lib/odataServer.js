'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * ODataServer class - main facade
 */

/* eslint no-useless-escape: 0 */

const { EventEmitter } = require('events')

const metadata = require('./metadata.js')
const collections = require('./collections.js')
const query = require('./query.js')
const insert = require('./insert.js')
const update = require('./update.js')
const remove = require('./remove.js')
const batch = require('./batch.js')

const Router = require('./router.js')
const prune = require('./prune.js')
const Buffer = require('safe-buffer').Buffer

class ODataServer extends EventEmitter {
  constructor(serviceUrl) {
    this.serviceUrl = serviceUrl

    this.cfg = {
      _parser,
      serviceUrl,
      afterRead: function () { },
      beforeQuery: function (col, query, req, cb) { cb() },
      executeQuery: ODataServer.prototype.executeQuery.bind(this),
      beforeInsert: function (col, query, req, cb) { cb() },
      executeInsert: ODataServer.prototype.executeInsert.bind(this),
      beforeUpdate: function (col, query, update, req, cb) { cb() },
      executeUpdate: ODataServer.prototype.executeUpdate.bind(this),
      beforeRemove: function (col, query, req, cb) { cb() },
      executeRemove: ODataServer.prototype.executeRemove.bind(this),
      base64ToBuffer: ODataServer.prototype.base64ToBuffer.bind(this),
      bufferToBase64: ODataServer.prototype.bufferToBase64.bind(this),
      pruneResults: ODataServer.prototype.pruneResults.bind(this),
      addCorsToResponse: ODataServer.prototype.addCorsToResponse.bind(this)
    }
  }

  addParser(parser) {
    this.cfg._parser = parser
  }

  handle(req, res) {
    if (!this.cfg.serviceUrl && !req.protocol) {
      throw new Error('Unable to determine service url from the express request or value provided in the ODataServer constructor.')
    }

    // If mounted in express, trim off the subpath (req.url) giving us just the base path
    const basePath = (req.originalUrl || '/')
    const regexString = req.url.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')
    const regex = new RegExp(regexString + '$')
    const path = basePath.replace(regex, '')

    if (!this.cfg.serviceUrl) {
      this.cfg.serviceUrl = (req.protocol + '://' + req.get('host') + path)
    }

    const urlObj = new URL(this.cfg.serviceUrl)
    const prefix = urlObj.pathname

    if (!this.router || (prefix !== this.router.prefix)) {
      this.router = new Router(prefix)
      this.#initializeRoutes()
    }

    this.router.dispatch(req, res)
  }

  #initializeRoutes() {
    this.router.get('/\$metadata', (req, res) => {
      const result = metadata(self.cfg)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/xml')
      res.setHeader('DataServiceVersion', '4.0')
      res.setHeader('OData-Version', '4.0')
      this.cfg.addCorsToResponse(res)

      return res.end(result)
    })

    this.router.get('/:collection/\$count', (req, res) => {
      req.params.$count = true
      query(this.cfg, req, res)
    })

    this.router.get('/:collection\\(:id\\)', (req, res) => {
      query(this.cfg, req, res)
    })

    this.router.get('/:collection', (req, res) => {
      query(this.cfg, req, res)
    })

    this.router.get('/', (req, res) => {
      const result = collections(this.cfg)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      this.cfg.addCorsToResponse(res)

      return res.end(result)
    })

    this.router.post('/:collection', (req, res) => {
      insert(this.cfg, req, res)
    })

    this.router.patch('/:collection\\(:id\\)', (req, res) => {
      update(this.cfg, req, res)
    })

    this.router.delete('/:collection\\(:id\\)', (req, res) => {
      remove(this.cfg, req, res)
    })

    this.router.post('/\$batch', (req, res) => {
      batch(req, res)
    })

    if (this.cfg.cors) {
      this.router.options('/(.*)', (req, res) => {
        res.statusCode = 200

        res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, POST, PATCH, PUT, DELETE')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mime-Version, OData-MaxVersion, OData-Version, X-CSRF-Token')
        res.setHeader('Access-Control-Expose-Headers', 'OData-MaxVersion, OData-Version, X-CSRF-Token')
        res.setHeader('OData-Version', '4.0')

        res.setHeader('Access-Control-Allow-Origin', this.cfg.cors)
        res.end()
      })
    }

    this.router.error((req, res, error) => {
      const def = (e) => {
        this.emit('odata-error', e)

        res.statusCode = (error.code && error.code >= 100 && error.code < 600) ? error.code : 500
        res.setHeader('Content-Type', 'application/json')
        this.cfg.addCorsToResponse(res)

        res.end(JSON.stringify({
          error: {
            code: error.code || 500,
            message: e.message,
            stack: e.stack,
            target: req.url,
            details: []
          },
          innererror: {}
        }))
      }

      if (this.cfg.error) {
        this.cfg.error(req, res, error, def)
      } else {
        def(error)
      }
    })
  }

  error(fn) {
    this.cfg.error = fn.bind(this)
    return this
  }

  query(fn) {
    this.cfg.query = fn.bind(this)
    return this
  }

  cors(domains) {
    this.cfg.cors = domains
    return this
  }

  beforeQuery(fn) {
    if (fn.length === 3) {
      console.warn('Listener function should accept request parameter.')
      const origFn = fn
      fn = function (col, query, req, cb) {
        origFn(col, query, cb)
      }
    }

    this.cfg.beforeQuery = fn.bind(this)
    return this
  }

  executeQuery(col, query, req, cb) {
    this.cfg.beforeQuery(col, query, req, (err) => {
      if (err) {
        return cb(err)
      }

      this.cfg.query(col, query, req, (err, res) => {
        if (err) {
          return cb(err)
        }

        this.cfg.afterRead(col, res, req)
        cb(null, res)
      })
    })
  }

  insert(fn) {
    this.cfg.insert = fn.bind(this)
    return this
  }

  beforeInsert(fn) {
    if (fn.length === 3) {
      console.warn('Listener function should accept request parameter.')
      const origFn = fn
      fn = function (col, doc, req, cb) {
        origFn(col, doc, cb)
      }
    }

    this.cfg.beforeInsert = fn.bind(this)
    return this
  }

  executeInsert(col, doc, req, cb) {
    this.cfg.beforeInsert(col, doc, req, (err) => {
      if (err) {
        return cb(err)
      }

      this.cfg.insert(col, doc, req, cb)
    })
  }

  update(fn) {
    this.cfg.update = fn.bind(this)
    return this
  }

  beforeUpdate(fn) {
    if (fn.length === 4) {
      console.warn('Listener function should accept request parameter.')
      const origFn = fn
      fn = function (col, query, update, req, cb) {
        origFn(col, query, update, cb)
      }
    }

    this.cfg.beforeUpdate = fn.bind(this)
    return this
  }

  executeUpdate(col, query, update, req, cb) {
    this.cfg.beforeUpdate(col, query, update, req, (err) => {
      if (err) {
        return cb(err)
      }

      this.cfg.update(col, query, update, req, cb)
    })
  }

  remove(fn) {
    this.cfg.remove = fn.bind(this)
    return this
  }

  beforeRemove(fn) {
    if (fn.length === 3) {
      console.warn('Listener function should accept request parameter.')
      const origFn = fn
      fn = function (col, query, req, cb) {
        origFn(col, query, cb)
      }
    }

    this.cfg.beforeRemove = fn.bind(this)
    return this
  }

  executeRemove(col, query, req, cb) {
    this.cfg.beforeRemove(col, query, req, (err) => {
      if (err) {
        return cb(err)
      }

      this.cfg.remove(col, query, req, cb)
    })
  }

  afterRead(fn) {
    this.cfg.afterRead = fn
    return this
  }

  model(model) {
    this.cfg.model = model
    return this
  }

  adapter(adapter) {
    adapter(this)
    return this
  }

  pruneResults(collection, res) {
    prune(this.cfg.model, collection, res)
  }

  base64ToBuffer(collection, doc) {
    const model = this.cfg.model
    const entitySet = model.entitySets[collection]
    const entityType = model.entityTypes[entitySet.entityType.replace(model.namespace + '.', '')]

    for (const prop in doc) {
      if (!prop) {
        continue
      }

      const propDef = entityType[prop]

      if (!propDef) {
        continue
      }

      if (propDef.type === 'Edm.Binary') {
        doc[prop] = Buffer.from(doc[prop], 'base64')
      }
    }
  }

  bufferToBase64(collection, res) {
    const model = this.cfg.model
    const entitySet = model.entitySets[collection]
    const entityType = model.entityTypes[entitySet.entityType.replace(model.namespace + '.', '')]

    for (const i in res) {
      const doc = res[i]
      for (const prop in doc) {
        if (!prop) {
          continue
        }

        const propDef = entityType[prop]

        if (!propDef) {
          continue
        }

        if (propDef.type === 'Edm.Binary') {
          // nedb returns object instead of buffer on node 4
          if (!Buffer.isBuffer(doc[prop]) && !doc[prop].length) {
            let obj = doc[prop]
            obj = obj.data || obj
            doc[prop] = Object.keys(obj).map(key => obj[key])
          }

          // unwrap mongo style buffers
          if (doc[prop]._bsontype === 'Binary') {
            doc[prop] = doc[prop].buffer
          }

          doc[prop] = Buffer.from(doc[prop]).toString('base64')
        }
      }
    }
  }
  
  addCorsToResponse(res) {
    if (this.cfg.cors) {
      res.setHeader('Access-Control-Allow-Origin', this.cfg.cors)
    }
  }
}

module.exports = ODataServer
