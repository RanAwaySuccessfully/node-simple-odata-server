'use strict'

const http = require('node:http')
const crypto = require('node:crypto')

module.exports = async function (req, res) {
  const prefix = req.originalUrl.match(/(\/.+\/)/)[1]

  const contentType = req.headers['content-type']
  const id = contentType.match(/boundary=(.+)/)[1]

  let results
  try {
    results = multipartMixed(req.body, id)
  } catch (error) {
    res.statusCode = 400
    res.end()
  }

  const promises = results.parts.map(obj => {
    const multi = obj.body
    multi.headers.cookie = req.headers.cookie

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
          resolve({ response, body })
        })
      })

      if (multi.body) {
        loopback.write(multi.body)
      }

      loopback.end()
      loopback.on('error', reject)
    })
  })

  const id2 = `batchresponse_${genId()}`
  const objToString = ([key, value]) => `${key}:${value}`

  return await Promise.all(promises).then(loopbacks => {
    const strings = loopbacks.map((loopback, index) => {
      const result = results.parts[index]

      const headerEntries = Object.entries(loopback.response.headers)
      const headers = headerEntries.map(objToString)

      const mainEntries = Object.entries(result.headers)
      const main = mainEntries.map(objToString)

      headers.unshift(`${result.body.http} ${loopback.response.statusCode} ${loopback.response.statusMessage}`)
      return `--${id2}\n${main.join('\n')}\n\n${headers.join('\n')}\n\n${loopback.body.toString()}`
    })

    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, OData-Version')
    res.setHeader('Content-Type', `multipart/mixed; boundary=${id2}`)
    res.setHeader('OData-Version', '4.0')

    const body = `${strings.join('\n')}\n--${id2}--`.replace(/\n/g, '\r\n')
    res.end(body)
  }).catch(() => {
    res.statusCode = 500
    res.end()
  })
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

    if (obj.headers['Content-Type'] === 'application/json') {
      obj.body = JSON.parse(obj.body)
    }

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
    const entries = header.match(/([^:]+):(.+)/)
    entries.shift()
    return entries
  })

  result.headers = Object.fromEntries(headerEntries)
  result.body = body
  return result
}
