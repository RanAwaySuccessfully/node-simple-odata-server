'use strict'

function keys (o) {
  const res = []
  const k = Object.keys(o)
  for (const i in k) {
    if (k[i].lastIndexOf('@', 0) === 0) {
      res.splice(0, 0, k[i])
    } else {
      res.push(k[i])
    }
  }
  return res
}

function sortProperties (o) {
  const res = {}
  const props = keys(o)

  for (let i = 0; i < props.length; i++) {
    res[props[i]] = o[props[i]]
  }
  return res
}

function removeOdataType (doc) {
  if (doc instanceof Array) {
    for (const i in doc) {
      if (typeof doc[i] === 'object' && doc[i] !== null) {
        removeOdataType(doc[i])
      }
    }
  }

  delete doc['@odata.type']

  for (const prop in doc) {
    if (typeof doc[prop] === 'object' && doc[prop] !== null) {
      removeOdataType(doc[prop])
    }
  }
}

module.exports = function (req, res) {
  if (typeof req === 'function') {
    console.warn('DEPRECATED: This method should not be called directly and should be implemented by extending the BaseAdapter class.')

    if (!this._adapter) {
      this._adapter = {}
    }

    this._adapter.insert = req
    return this
  }

  if (req.body) {
    processBody.call(this, req, res, req.body)
  } else {
    let body = ''
    req.on('data', data => {
      body += data
      if (body.length > 1e6) {
        req.connection.destroy()
      }
    })

    req.on('end', () => {
      processBody.call(this, req, res, JSON.parse(body))
    })
  }
}

function processBody (req, res, body) {
  try {
    removeOdataType(body)
    this._base64ToBuffer(req.params.collection, body)
    this._beforeInsert(req.params.collection, body, req, err => {
      if (err) {
        return this._oDataError(req, res, err)
      }

      this._adapter.insert(req.params.collection, body, req, (err, entity) => {
        if (err) {
          return this._oDataError(req, res, err)
        }

        res.statusCode = 201
        res.setHeader('Content-Type', 'application/json;odata.metadata=minimal;odata.streaming=true;IEEE754Compatible=false;charset=utf-8')
        res.setHeader('OData-Version', '4.0')
        res.setHeader('Location', this._serviceUrl + '/' + req.params.collection + "/('" + encodeURI(entity._id) + "')")
        this._addCorsToResponse(res)

        this._pruneResults(req.params.collection, entity)

        // odata.context must be first
        entity['@odata.id'] = this._serviceUrl + '/' + req.params.collection + "('" + entity._id + "')"
        entity['@odata.editLink'] = this._serviceUrl + '/' + req.params.collection + "('" + entity._id + "')"
        entity['@odata.context'] = this._serviceUrl + '/$metadata#' + req.params.collection + '/$entity'

        entity = sortProperties(entity)
        this._bufferToBase64(req.params.collection, [entity])

        return res.end(JSON.stringify(entity))
      })
    })
  } catch (e) {
    this._oDataError(req, res, e)
  }
}
