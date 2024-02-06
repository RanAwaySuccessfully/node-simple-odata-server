'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * Orchestrate the OData query GET requests
 */

const parser = require('odata-parser')
const queryTransform = require('./queryTransform.js')
const querystring = require('node:querystring')

module.exports = function (req, res) {
  if (typeof req === 'function') {
    console.warn('DEPRECATED: This method should not be called directly and should be implemented by extending the BaseAdapter class.')

    if (!this._adapter) {
      this._adapter = {}
    }

    this._adapter.query = req
    return this
  }

  if (!this._model.entitySets[req.params.collection]) {
    const error = new Error('Entity set not Found')
    error.code = 404
    this._oDataError(req, res, error)
    return
  }

  let queryOptions = {
    $filter: {}
  }

  const _url = new URL(req.url, 'http://localhost/')
  if (_url.search) {
    const entries = new URLSearchParams(_url.search)
    const query = Object.fromEntries(entries)
    const fixedQS = {}
    if (query.$) fixedQS.$ = query.$
    if (query.$expand) fixedQS.$expand = query.$expand
    if (query.$filter) fixedQS.$filter = query.$filter
    if (query.$format) fixedQS.$format = query.$format
    if (query.$inlinecount) fixedQS.$inlinecount = query.$inlinecount
    if (query.$select) fixedQS.$select = query.$select
    if (query.$skip) fixedQS.$skip = query.$skip
    if (query.$top) fixedQS.$top = query.$top
    if (query.$orderby) fixedQS.$orderby = query.$orderby

    const encodedQS = decodeURIComponent(querystring.stringify(fixedQS))
    if (encodedQS) {
      queryOptions = queryTransform(parser.parse(encodedQS))
    }
    if (query.$count) {
      queryOptions.$inlinecount = true
    }
  }

  queryOptions.collection = req.params.collection

  if (req.params.$count) {
    queryOptions.$count = true
  }

  if (req.params.id) {
    req.params.id = req.params.id.replace(/"/g, '').replace(/'/g, '')
    queryOptions.$filter = {
      _id: req.params.id
    }
  }

  this._beforeQuery(queryOptions.collection, queryOptions, req, err => {
    if (err) {
      return this._oDataError(req, res, err)
    }

    this._adapter.query(queryOptions.collection, queryOptions, req, (err, result) => {
      if (err) {
        return this._oDataError(req, res, err)
      }

      this._afterRead(queryOptions.collection, res, req)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json;odata.metadata=minimal')
      res.setHeader('OData-Version', '4.0')
      this._addCorsToResponse(res)

      let out = {}
      // define the @odataContext in case of selection
      let sAdditionIntoContext = ''
      const oSelect = queryOptions.$select
      if (oSelect) {
        const countProp = Object.keys(oSelect).length
        let ctr = 1
        for (const key in oSelect) {
          sAdditionIntoContext += key.toString() + (ctr < countProp ? ',' : '')
          ctr++
        }
      }
      if (Object.prototype.hasOwnProperty.call(queryOptions.$filter, '_id')) {
        sAdditionIntoContext = sAdditionIntoContext.length > 0 ? '(' + sAdditionIntoContext + ')/$entity' : '/$entity'
        out['@odata.context'] = this._serviceUrl + '/$metadata#' + req.params.collection + sAdditionIntoContext
        if (result.length > 0) {
          for (const key in result[0]) {
            out[key] = result[0][key]
          }
        }
        // this shouldn't be done, but for backcompatibility we keep it for now
        out.value = result
      } else {
        sAdditionIntoContext = sAdditionIntoContext.length > 0 ? '(' + sAdditionIntoContext + ')' : ''
        out = {
          '@odata.context': this._serviceUrl + '/$metadata#' + req.params.collection + sAdditionIntoContext,
          value: result
        }
      }

      if (queryOptions.$inlinecount) {
        out['@odata.count'] = result.count
        out.value = result.value
      }

      this._pruneResults(queryOptions.collection, out.value)

      this._bufferToBase64(queryOptions.collection, out.value)

      return res.end(JSON.stringify(out))
    })
  })
}
