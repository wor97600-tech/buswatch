import fetch from '@blueos.network.fetch'
import config from './config'

const NET = config.net || {}
const DEFAULT_TIMEOUT = NET.timeout || 12000
const schemeMemory = {}
const inflight = {}

// 服务端支持 gzip，可把 69KB 的城市列表压到约 7KB。
// 若手表端不支持自动解压导致解析失败，会自动关闭并重试。
let gzipEnabled = NET.gzip !== false

export function setGzipEnabled(value) {
  gzipEnabled = Boolean(value)
}

export function isGzipEnabled() {
  return gzipEnabled
}

function makeError(message, type, status, detail) {
  const error = new Error(message)
  error.type = type || 'unknown'
  if (status !== undefined) {
    error.status = status
  }
  if (detail !== undefined) {
    error.detail = detail
  }
  return error
}

export function isRetryable(error) {
  if (!error) {
    return false
  }
  if (error.type === 'transport' || error.type === 'timeout') {
    return true
  }
  if (error.type === 'http' && error.status >= 500) {
    return true
  }
  return false
}

function normalizeBody(raw) {
  if (raw === undefined || raw === null) {
    return ''
  }
  if (typeof raw === 'string') {
    return raw
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw)
  }
  return raw
}

function tryParse(value) {
  if (value && typeof value === 'object') {
    return { ok: true, value: value }
  }
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!text) {
    return { ok: false, value: null }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, value: null, text: text }
  }
}

function failDetail(data) {
  if (!data) {
    return ''
  }
  if (typeof data === 'string') {
    return data.slice(0, 40)
  }
  if (typeof data === 'object') {
    const text = data.message || data.msg || data.errMsg || data.error || data.detail || ''
    return String(text).slice(0, 40)
  }
  return String(data).slice(0, 40)
}

function rawRequest(url, options) {
  const opts = options || {}
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  const method = opts.method || 'GET'

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    const finish = (fn, value) => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      fn(value)
    }

    if (typeof setTimeout === 'function') {
      timer = setTimeout(() => {
        timer = null
        finish(reject, makeError(`请求超时（${Math.round(timeout / 1000)}秒）`, 'timeout'))
      }, timeout)
    }

    const sender =
      fetch && typeof fetch.fetch === 'function'
        ? fetch.fetch
        : typeof fetch === 'function'
          ? fetch
          : null

    if (!sender) {
      finish(reject, makeError('当前环境不支持网络请求', 'unsupported'))
      return
    }

    const baseHeader = opts.headers || {}
    const requestOptions = {
      url: url,
      method: method,
      responseType: 'text',
      header: gzipEnabled
        ? Object.assign({ 'Accept-Encoding': 'gzip' }, baseHeader)
        : baseHeader,
      success: (response) => {
        const hasStatus = Boolean(
          response && response.code !== undefined && response.code !== null && response.code !== ''
        )
        const status = hasStatus ? Number(response.code) : 200
        const body = normalizeBody(response && response.data)

        if (hasStatus && (status < 200 || status >= 300)) {
          const detail = typeof body === 'string' ? body.slice(0, 120) : ''
          finish(reject, makeError(`服务返回 HTTP ${status}`, 'http', status, detail))
          return
        }

        if (opts.json === false) {
          finish(resolve, { data: body, status: status, url: url })
          return
        }

        const hasBody = typeof body === 'string' ? body.length > 0 : true
        if (!hasBody) {
          finish(reject, makeError('返回内容为空', 'empty', status))
          return
        }

        const parsed = tryParse(body)
        if (!parsed.ok) {
          const snippet = parsed.text ? parsed.text.slice(0, 60) : ''
          finish(reject, makeError('返回内容无法解析', 'json', status, snippet))
          return
        }
        finish(resolve, { data: parsed.value, status: status, url: url })
      },
      fail: (data, code) => {
        const detail = failDetail(data)
        const suffix = code === undefined || code === null || code === '' ? '' : ` (${code})`
        finish(
          reject,
          makeError(`网络请求失败${suffix}${detail ? ' ' + detail : ''}`, 'transport', code, detail)
        )
      }
    }

    if (opts.body !== undefined) {
      requestOptions.data = opts.body
    }

    try {
      sender(requestOptions)
    } catch (error) {
      finish(reject, makeError(String((error && error.message) || error), 'transport'))
    }
  })
}

export function request(url, options) {
  const opts = options || {}
  const key = `${opts.method || 'GET'} ${url} ${opts.body === undefined ? '' : String(opts.body)}`
  if (inflight[key]) {
    return inflight[key]
  }
  const startedAt = Date.now()
  const task = rawRequest(url, opts).then(
    (result) => {
      delete inflight[key]
      result.elapsed = Date.now() - startedAt
      return result
    },
    (error) => {
      delete inflight[key]
      error.elapsed = Date.now() - startedAt
      throw error
    }
  )
  inflight[key] = task
  return task
}

export function buildQuery(params) {
  return Object.keys(params || {})
    .filter((key) => {
      const value = params[key]
      return value !== undefined && value !== null && value !== ''
    })
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

function rememberScheme(host, url) {
  const matched = String(url || '').match(/^(https?):\/\//)
  if (matched && host) {
    schemeMemory[host] = matched[1]
  }
}

function schemeOrder(host, preferHttps) {
  if (NET.allowHttps === false) {
    return ['http']
  }
  const remembered = schemeMemory[host]
  if (remembered) {
    return [remembered, remembered === 'https' ? 'http' : 'https']
  }
  const httpsFirst = preferHttps === undefined ? NET.preferHttps === true : preferHttps === true
  return httpsFirst ? ['https', 'http'] : ['http', 'https']
}

export function apiUrls(host, path, params, preferHttps) {
  const query = buildQuery(params)
  const suffix = query ? `?${query}` : ''
  return schemeOrder(host, preferHttps).map((scheme) => `${scheme}://${host}${path}${suffix}`)
}

function raceRequest(urls, options, onAttempt) {
  const list = (urls || []).filter(Boolean)
  if (list.length === 0) {
    return Promise.reject(makeError('请求地址为空', 'invalid'))
  }
  const opts = options || {}
  const hedgeDelay = opts.hedgeDelay === undefined ? NET.hedgeDelay || 3000 : opts.hedgeDelay
  const startedFlags = list.map(() => false)

  return new Promise((resolve, reject) => {
    let settled = false
    let failed = 0
    let hedgeTimer = null
    const errors = []

    const finish = (fn, value) => {
      if (settled) {
        return
      }
      settled = true
      if (hedgeTimer) {
        clearTimeout(hedgeTimer)
        hedgeTimer = null
      }
      fn(value)
    }

    const fireNext = () => {
      if (settled) {
        return
      }
      for (let i = 0; i < list.length; i++) {
        if (startedFlags[i]) {
          continue
        }
        startedFlags[i] = true
        if (typeof onAttempt === 'function') {
          onAttempt()
        }
        request(list[i], opts).then(
          (result) => finish(resolve, result),
          (error) => {
            errors[i] = error
            failed += 1
            if (settled) {
              return
            }
            if (failed >= list.length) {
              const last = errors.filter(Boolean)
              finish(reject, last[last.length - 1])
              return
            }
            fireNext()
          }
        )
        return
      }
    }

    fireNext()
    if (list.length > 1 && hedgeDelay > 0 && typeof setTimeout === 'function') {
      hedgeTimer = setTimeout(() => {
        hedgeTimer = null
        if (!settled) {
          fireNext()
        }
      }, hedgeDelay)
    }
  })
}

function delay(ms) {
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') {
      setTimeout(resolve, ms)
    } else {
      resolve()
    }
  })
}

export function requestApi(host, path, params, options) {
  const opts = options || {}
  const urls = apiUrls(host, path, params, opts.preferHttps)
  const retry = opts.retry === undefined ? 0 : opts.retry
  let attempts = 0

  const run = (left) => {
    return raceRequest(urls, opts, () => {
      attempts += 1
    }).then(
      (result) => {
        result.attempts = attempts
        return result
      },
      (error) => {
        if (left > 0 && isRetryable(error)) {
          return delay(NET.retryDelay || 700).then(() => run(left - 1))
        }
        error.attempts = attempts
        throw error
      }
    )
  }

  return run(retry).then((result) => {
    rememberScheme(host, result.url)
    return result
  })
}

export function describeError(error) {
  if (!error) {
    return '网络异常'
  }
  const type = error.type
  if (type === 'timeout') {
    return '请求超时'
  }
  if (type === 'http') {
    return `服务返回 ${error.status || ''}`.trim()
  }
  if (type === 'json') {
    return '数据格式异常'
  }
  if (type === 'empty') {
    return '返回内容为空'
  }
  if (type === 'unsupported') {
    return '系统不支持网络'
  }
  if (type === 'transport') {
    return '网络不可用'
  }
  const message = error.message ? String(error.message) : ''
  return message.slice(0, 24) || '网络异常'
}

export default {
  request,
  requestApi,
  apiUrls,
  buildQuery,
  isRetryable,
  describeError
}
