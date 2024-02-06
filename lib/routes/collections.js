'use strict'

/*!
 * Copyright(c) 2014 Jan Blaha (pofider)
 *
 * Orchestrate the OData / request
 */

module.exports = function (serviceUrl, model) {
  const collections = []
  for (const key in model.entitySets) {
    collections.push({
      kind: 'EntitySet',
      name: key,
      url: key
    })
  }

  return JSON.stringify({
    '@odata.context': serviceUrl + '/$metadata',
    value: collections
  })
}
