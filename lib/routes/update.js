'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * Orchestrate the OData PATCH requests
 */

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

    this._adapter.update = req
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

function processBody(req, res, body) {
  removeOdataType(body)

  const query = {
    _id: req.params.id.replace(/"/g, '').replace(/'/g, '')
  }

  const update = {
    $set: body
  }

  try {
    this._base64ToBuffer(req.params.collection, update.$set)

    const col = req.params.collection

    this._beforeUpdate(col, query, update, req, err => {
      if (err) {
        return this._oDataError(req, res, err)
      }

      this._adapter.update(col, query, update, req, (e, entity) => {
        if (e) {
          return this._oDataError(req, res, e)
        }

        res.statusCode = 204
        this._addCorsToResponse(res)

        res.end()
      })
    })
  } catch (e) {
    this._oDataError(req, res, e)
  }
}