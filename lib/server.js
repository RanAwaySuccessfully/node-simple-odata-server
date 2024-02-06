'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * ODataServer class - main facade
 */

const { EventEmitter } = require('node:events')

const Router = require('./router.js')
const prune = require('./prune.js')

const collections = require('./routes/collections.js')
const metadata = require('./routes/metadata.js')
const insert = require('./routes/insert.js')
const remove = require('./routes/remove.js')
const update = require('./routes/update.js')
const query = require('./routes/query.js')
const batch = require('./routes/batch.js')

class ODataServer extends EventEmitter {
  #router

  _serviceUrl
  _adapter
  _model
  _cors

  _beforeQuery = (col, query, req, cb) => cb()
  _beforeUpdate = (col, query, update, req, cb) => cb()
  _beforeInsert = (col, query, req, cb) => cb()
  _beforeRemove = (col, query, req, cb) => cb()
  _afterRead = () => {}
  _errorFn

  constructor (serviceUrl) {
    super()
    this._serviceUrl = serviceUrl
  }

  handle (req, res) {
    if (!this._serviceUrl && !req.protocol) {
      throw new Error('Unable to determine serviceUrl from the express request or value provided in the ODataServer constructor.')
    }

    // If mounted in express, trim off the subpath (req.url) giving us just the base path
    const basePath = (req.originalUrl || '/')
    const regexString = req.url.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')
    const regex = new RegExp(regexString + '$')
    const path = basePath.replace(regex, '')

    if (!this._serviceUrl) {
      this._serviceUrl = (req.protocol + '://' + req.get('host') + path)
    }

    const urlObj = new URL(this._serviceUrl)
    const prefix = urlObj.pathname

    if (!this.#router || (prefix !== this.#router.prefix)) {
      this.#router = new Router(prefix)
      this.#initializeRoutes()
    }

    try {
      this.#router.handle(req, res)
    } catch (error) {
      this._oDataError(req, res, error)
    }
  }

  #initializeRoutes () {
    this.#router.get('/', (req, res) => {
      const result = this.collections(this._serviceUrl, this._model)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      this._addCorsToResponse(res)

      return res.end(result)
    })

    this.#router.get('/\$metadata', (req, res) => { // eslint-disable-line no-useless-escape
      const result = this.metadata(this._model)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/xml')
      res.setHeader('DataServiceVersion', '4.0')
      res.setHeader('OData-Version', '4.0')
      this._addCorsToResponse(res)

      return res.end(result)
    })

    this.#router.post('/\$batch', (req, res) => { // eslint-disable-line no-useless-escape
      this.batch(req, res)
    })

    this.#router.get('/:collection/\$count', (req, res) => { // eslint-disable-line no-useless-escape
      req.params.$count = true
      this.query(req, res)
    })

    this.#router.get('/:collection\\(:id\\)', (req, res) => {
      this.query(req, res)
    })

    this.#router.get('/:collection', (req, res) => {
      this.query(req, res)
    })

    this.#router.post('/:collection', (req, res) => {
      this.insert(req, res)
    })

    this.#router.patch('/:collection\\(:id\\)', (req, res) => {
      this.update(req, res)
    })

    this.#router.delete('/:collection\\(:id\\)', (req, res) => {
      this.remove(req, res)
    })

    this.#router.options('/(.*)', (req, res) => {
      res.statusCode = 200
      res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, POST, PATCH, PUT, DELETE')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mime-Version, OData-MaxVersion, OData-Version, X-CSRF-Token')
      res.setHeader('Access-Control-Expose-Headers', 'OData-MaxVersion, OData-Version, X-CSRF-Token')
      res.setHeader('OData-Version', '4.0')

      if (this._cors) {
        res.setHeader('Access-Control-Allow-Origin', this._cors)
      }

      res.end()
    })
  }

  beforeQuery (fn) {
    if (fn.length === 3) {
      console.warn('DEPRECATED: Listener function should now accept request parameter.')
      const origFn = fn
      fn = (col, query, req, cb) => {
        origFn(col, query, cb)
      }
    }

    this._beforeQuery = fn
    return this
  }

  beforeUpdate (fn) {
    if (fn.length === 4) {
      console.warn('DEPRECATED: Listener function should now accept request parameter.')
      const origFn = fn
      fn = (col, query, update, req, cb) => {
        origFn(col, query, update, cb)
      }
    }

    this._beforeUpdate = fn
    return this
  }

  beforeInsert (fn) {
    if (fn.length === 3) {
      console.warn('DEPRECATED: Listener function should now accept request parameter.')
      const origFn = fn
      fn = (col, doc, req, cb) => {
        origFn(col, doc, cb)
      }
    }

    this._beforeInsert = fn
    return this
  }

  beforeRemove (fn) {
    if (fn.length === 3) {
      console.warn('DEPRECATED: Listener function should now accept request parameter.')
      const origFn = fn
      fn = function (col, query, req, cb) {
        origFn(col, query, cb)
      }
    }

    this._beforeRemove = fn
    return this
  }

  afterRead (fn) {
    this._afterRead = fn
    return this
  }

  error (fn) {
    this._error = fn
  }

  adapter (adapter) {
    if (typeof adapter === 'function') {
      console.warn('DEPRECATED: Parameter should now be extended from the BaseAdapter class.')
      this._adapter = {}
      adapter.call(this)
      return this
    }

    this._adapter = adapter
    return this
  }

  model (model) {
    this._model = model
    return this
  }

  cors (domains) {
    this._cors = domains
    return this
  }

  _oDataError (req, res, err) {
    if (this._errorFn) {
      this._errorFn(req, res, err, this.#defaultErrorHandler)
    } else {
      this.#defaultErrorHandler(req, res, err)
    }
  }

  _addCorsToResponse (res) {
    res.setHeader('Access-Control-Expose-Headers', 'OData-MaxVersion, OData-Version, X-CSRF-Token')
    res.setHeader('OData-Version', '4.0')

    if (this._cors) {
      res.setHeader('Access-Control-Allow-Origin', this._cors)
    }
  }

  _base64ToBuffer (collection, doc) {
    const model = this._model
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

  _bufferToBase64 (collection, res) {
    const model = this._model
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
            console.warn('DEPRECATED: nedb')
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

  _pruneResults (collection, res) {
    prune(this._model, collection, res)
  }

  #defaultErrorHandler (req, res, error) {
    this.emit('odata-error', error)

    res.statusCode = (error.code && error.code >= 100 && error.code < 600) ? error.code : 500
    res.setHeader('Content-Type', 'application/json')
    this._addCorsToResponse(res)

    res.end(JSON.stringify({
      error: {
        code: error.code || 500,
        message: error.message,
        stack: error.stack,
        target: req.url,
        details: []
      },
      innererror: { }
    }))
  }
}

Object.assign(ODataServer.prototype, {
  collections,
  metadata,
  query,
  batch,
  insert,
  remove,
  update
})

module.exports = ODataServer
