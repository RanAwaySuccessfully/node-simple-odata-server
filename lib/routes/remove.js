'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * Orchestrate the OData DELETE request
 */

module.exports = function (req, res) {
  if (typeof req === 'function') {
    console.warn('DEPRECATED: This method should not be called directly and should be implemented by extending the BaseAdapter class.')

    if (!this._adapter) {
      this._adapter = {}
    }

    this._adapter.remove = req
    return this
  }

  try {
    const query = {
      _id: req.params.id.replace(/"/g, '').replace(/'/g, '')
    }

    const col = req.params.collection

    this._beforeRemove(col, query, req, err => {
      if (err) {
        return this._oDataError(req, res, err)
      }

      this._adapter.remove(col, query, req, () => {
        if (err) {
          return this._oDataError(req, res, err)
        }

        res.statusCode = 204
        this._addCorsToResponse(res)

        res.end()
      })
    })
  } catch (e) {
    return this._oDataError(req, res, e)
  }
}
