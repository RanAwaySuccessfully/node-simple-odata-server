'use strict'

const http = require('node:http')
const crypto = require('node:crypto')

module.exports = async function (req, res) {
  const contentType = req.headers['content-type']
  const id = getBoundaryId(contentType)

  let results
  try {
    results = multipartMixed(req.body, id)
  } catch (error) {
    res.statusCode = 400
    res.end()
    return
  }

  const response_id = `batchresponse_${genId()}`
  const strings = await doBatch(req, results, response_id, false)

  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, OData-Version')
  res.setHeader('Content-Type', `multipart/mixed; boundary=${ response_id }`)
  res.setHeader('OData-Version', '4.0')

  const body = strings.replace(/\n/g, '\r\n')
  res.end(body)
}

function objToString ([key, value]) {
  return `${key}:${value}`
}

async function doBatch (req, results, id, isChangeSet) {

  const promises = results.parts.map(async part => {
    if (part.body.parts) {
      const innerId = `changeset_${genId()}`;

      const innerBatch = await doBatch(req, part.body, innerId, true)
      const strings = [];

      strings.push(`--${ id }`)
      strings.push(`Content-Type: multipart/mixed; boundary=${ innerId }\n`);
      strings.push(innerBatch);

      return strings.join("\n")
    }

    const response = await makeRequest(req, part)
    const result = response.sent

    const headerEntries = Object.entries(response.response.headers)
    const headers = headerEntries.map(objToString)

    const mainEntries = Object.entries(result.headers)
    const main = mainEntries.map(objToString)

    headers.unshift(`${result.body.http} ${response.response.statusCode} ${response.response.statusMessage}`)
    const string = `--${ id }\n${ main.join('\n')}\n\n${ headers.join('\n') }\n\n${ response.body.toString() }`
    return string
  });

  const strings = await Promise.all(promises)

  strings.push(`--${ id }--`)
  return strings.join("\n")
}

function makeRequest (req, obj) {
  const multi = obj.body
  
  multi.headers.cookie = req.headers.cookie

  const prefix = req.originalUrl.match(/(\/.+\/)/)[1]

  return new Promise((resolve, reject) => {
    const loopback = http.request({
      path: prefix + multi.path,
      headers: multi.headers,
      method: multi.method,
      port: req.socket.localPort
    }, (response) => {
      const array = []
      response.on('data', (chunk) => array.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(array)
        resolve({ response, body, sent: obj })
      })
    })

    if (multi.body) {
      loopback.write(multi.body)
    }

    loopback.end()
    loopback.on('error', reject)
  })
}

function getBoundaryId (contentType) {
  return contentType.match(/boundary=(.+)/)[1]
}

function genId () {
  return crypto.randomBytes(5).toString('hex')
}

function multipartMixed (body, id) {
  const boundary = `--${id}`
  const finish = `--${id}--`
  const content = body.split(finish)
  const bodyParts = content[0].split(boundary)
  bodyParts.shift()

  const partsList = bodyParts.map(part => parseHttp(part, true))
  const formattedList = partsList.map(obj => {
    if (
      (obj.headers['Content-Type'] === 'application/http') &&
      (obj.headers['Content-Transfer-Encoding'] === 'binary')
    ) {
      obj.body = parseHttp(obj.body)
    }

    if (obj.headers['Content-Type'].startsWith("multipart/mixed")) {
      const id = getBoundaryId(obj.headers['Content-Type'])
      obj.body = multipartMixed(obj.body, id)
    }

    if (obj.headers['Content-Type'] === 'application/json') {
      obj.body = JSON.parse(obj.body)
    }

    obj.id = id
    return obj
  })

  const result = { parts: formattedList }

  if (content[1]) {
    result.footer = content[1].trim()
  }

  return result
}

function parseHttp (part, skipMethodPath) {
  const result = {}

  part = part.trim()
  const index = part.search(/\r?\n\r?\n/)

  let headers
  let body
  if (index === -1) {
    headers = part.trim()
    body = null
  } else {
    headers = part.slice(0, index).trim()
    body = part.slice(index).trim()
  }

  const headerList = headers.split('\n')
  if (!skipMethodPath) {
    const line = headerList.shift().trim()
    const match = line.match(/([A-Z]+) (\S+) (.+)/)

    result.method = match[1]
    result.path = match[2]
    result.http = match[3]
  }

  const headerEntries = headerList.map(header => {
    const entries = header.match(/([^:]+):\s*(.+)/)
    entries.shift()
    return entries
  })

  result.headers = Object.fromEntries(headerEntries)
  result.body = body
  return result
}
