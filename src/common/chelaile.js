import net from './net'
import config from './config'
import store from './store'
import core from './realtime-core'

const HOST = config.chelaile.host
const TIMEOUT = config.chelaile.timeout
const RETRY = config.chelaile.retry
const SLOW_TIMEOUT = config.chelaile.slowTimeout || 20000
const SLOW_RETRY = config.chelaile.slowRetry || 2
const SEARCH_TIMEOUT = config.chelaile.searchTimeout || 12000
const TTL = config.cache
const CITIES_TTL = 7 * 24 * 60 * 60 * 1000

let activeCityId = String(config.cityId)
let citiesMemory = null
let hotCitiesMemory = null

export function setCityId(cityId) {
  const next = String(cityId === undefined || cityId === null ? '' : cityId)
  activeCityId = next || String(config.cityId)
}

function cityOf(options) {
  const value = options && options.cityId
  return String(value || activeCityId)
}

function scopedKey(cityId, base) {
  return `${cityId}|${base}`
}

const HEADERS = {
  Accept: 'application/json'
}

function request(path, params, overrides) {
  const opts = overrides || {}
  return net
    .requestApi(HOST, path, params, {
      timeout: opts.timeout || TIMEOUT,
      retry: opts.retry === undefined ? RETRY : opts.retry,
      headers: HEADERS
    })
    .then((result) => {
      if (!result || !result.data || typeof result.data !== 'object') {
        const error = new Error('返回内容无法解析')
        error.type = 'json'
        throw error
      }
      return result.data
    })
}

function isEnabled() {
  return Boolean(config.chelaile && config.chelaile.enabled)
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeBus(bus) {
  const item = bus || {}
  return {
    busId: item.busId || '',
    order: core.toNumberOrNull(item.order),
    arrivalTime: core.toNumberOrNull(item.arrivalTime),
    travelTime: core.toNumberOrNull(item.travelTime),
    distanceToDest: core.toNumberOrNull(item.distanceToDest),
    capacity: core.toNumberOrNull(item.capacity),
    lat: core.toNumberOrNull(item.lat),
    lng: core.toNumberOrNull(item.lng)
  }
}

function normalizeStation(station) {
  const item = station || {}
  const lat = core.toNumberOrNull(item.lat)
  const lng = core.toNumberOrNull(item.lng)
  return {
    id: item.sId || item.stationId || '',
    name: item.sn || item.name || '',
    physicalStId: item.physicalStId || '',
    namesakeStId: item.namesakeStId || '',
    lat: lat,
    lng: lng,
    location: lng !== null && lat !== null ? `${lng},${lat}` : '',
    isSubway: item.isSubway === true,
    citycode: '',
    buslines: [],
    source: 'chelaile'
  }
}

function normalizePoi(poi) {
  const item = poi || {}
  const lat = core.toNumberOrNull(item.lat)
  const lng = core.toNumberOrNull(item.lng)
  return {
    name: item.name || '',
    address: item.address || '',
    tag: item.tag || '',
    district: item.district || '',
    gpsType: item.gpsType || '',
    lat: lat,
    lng: lng,
    location: lng !== null && lat !== null ? `${lng},${lat}` : '',
    source: 'chelaile'
  }
}

function normalizeSearchLine(entry) {
  const item = entry || {}
  const directions =
    Array.isArray(item.directions) && item.directions.length > 0 ? item.directions : [item]
  const list = []
  const seen = {}
  directions.forEach((direction) => {
    const lineId = direction.lineId || item.lineId || ''
    const id = `${lineId}_${direction.direction}`
    if (!lineId || seen[id]) {
      return
    }
    seen[id] = true
    list.push({
      id: lineId,
      key: id,
      lineName: item.name || item.lineNo || '',
      shortName: item.name || item.lineNo || '',
      direction: core.toNumberOrNull(direction.direction),
      startStop: direction.startSn || item.startSn || '',
      endStop: direction.endSn || item.endSn || '',
      source: 'chelaile'
    })
  })
  return list
}

function normalizeSearch(data) {
  const stations = safeArray(data.stations).map(normalizeStation)
  const pois = safeArray(data.pois)
    .map(normalizePoi)
    .filter((poi) => poi.tag !== '公交线路')
  const lines = []
  safeArray(data.lines).forEach((entry) => {
    normalizeSearchLine(entry).forEach((line) => {
      lines.push(line)
    })
  })
  return { stations: stations, lines: lines, pois: pois }
}

function withSearchMeta(data, cachedAt, stale) {
  return {
    stations: data.stations || [],
    lines: data.lines || [],
    pois: data.pois || [],
    cachedAt: cachedAt || 0,
    stale: Boolean(stale)
  }
}

export function searchAll(keyword, options) {
  const text = String(keyword === undefined || keyword === null ? '' : keyword).trim()
  if (!text) {
    return Promise.resolve(withSearchMeta({}, 0, false))
  }
  const opts = options || {}
  const cityId = cityOf(opts)
  const cacheKey = scopedKey(cityId, `search|${text}`)

  return store.getSearchCache(cacheKey).then((entry) => {
    const now = Date.now()
    const fresh = Boolean(entry && entry.ts && now - entry.ts < TTL.search)
    if (!opts.force && entry && entry.data) {
      if (!fresh) {
        request('/v1/search', { city_id: cityId, keyword: text }, { timeout: SEARCH_TIMEOUT })
          .then((data) => store.setSearchCache(cacheKey, normalizeSearch(data)))
          .catch(() => null)
      }
      return withSearchMeta(entry.data, entry.ts, !fresh)
    }
    return request('/v1/search', { city_id: cityId, keyword: text }, { timeout: SEARCH_TIMEOUT })
      .then((data) => {
        const parsed = normalizeSearch(data)
        const ts = Date.now()
        return store.setSearchCache(cacheKey, parsed).then(() => withSearchMeta(parsed, ts, false))
      })
      .catch((error) => {
        if (entry && entry.data) {
          return withSearchMeta(entry.data, entry.ts, true)
        }
        throw error
      })
  })
}

let warmedUp = false

export function warmUp() {
  if (warmedUp || !isEnabled()) {
    return
  }
  warmedUp = true
  searchAll('国贸').catch(() => null)
}

function normalizeCity(city) {
  const item = city || {}
  return {
    cityId: String(item.cityId || ''),
    cityName: item.cityName || '',
    pinyin: item.pinyin || '',
    hot: item.hot === true
  }
}

function validCities(data) {
  const cities = safeArray(data && data.cities)
    .map(normalizeCity)
    .filter((city) => city.cityId && city.cityName)
  if (cities.length === 0) {
    const error = new Error('城市列表为空')
    error.type = 'empty'
    throw error
  }
  return cities
}

function fetchHotCities() {
  return request('/v1/cities', { hot_only: 1 }).then((data) => {
    const cities = validCities(data)
    hotCitiesMemory = { ts: Date.now(), cities: cities }
    return { cities: cities, cachedAt: hotCitiesMemory.ts, stale: false }
  })
}

function fetchCities() {
  return request('/v1/cities', { hot_only: 0 }, { timeout: SLOW_TIMEOUT, retry: SLOW_RETRY }).then((data) => {
    const cities = validCities(data)
    return store.setCitiesCache(cities).then(() => {
      citiesMemory = { ts: Date.now(), cities: cities }
      return { cities: cities, cachedAt: citiesMemory.ts, stale: false }
    })
  })
}

export function getCities(options) {
  const opts = options || {}
  const hotOnly = opts.hotOnly === true
  if (!opts.force) {
    const memory = hotOnly ? hotCitiesMemory : citiesMemory
    if (memory && Date.now() - memory.ts < CITIES_TTL) {
      return Promise.resolve({ cities: memory.cities, cachedAt: memory.ts, stale: false })
    }
  }
  if (hotOnly) {
    return fetchHotCities().catch((error) => {
      if (citiesMemory) {
        return {
          cities: citiesMemory.cities.filter((city) => city.hot),
          cachedAt: citiesMemory.ts,
          stale: true,
          error: error
        }
      }
      throw error
    })
  }
  return store.getCitiesCache().then((entry) => {
    const hasCache = Boolean(entry && Array.isArray(entry.cities) && entry.cities.length > 0)
    const fresh = hasCache && Date.now() - entry.ts < CITIES_TTL
    if (hasCache) {
      citiesMemory = { ts: entry.ts, cities: entry.cities }
    }
    if (!opts.force && hasCache) {
      if (!fresh) {
        fetchCities().catch(() => null)
      }
      return {
        cities: entry.cities,
        cachedAt: entry.ts,
        stale: !fresh
      }
    }
    return fetchCities().catch((error) => {
      if (hasCache) {
        return { cities: entry.cities, cachedAt: entry.ts, stale: true, error: error }
      }
      throw error
    })
  })
}

function normalizeStopDetail(data, fallback) {
  const base = fallback || {}
  const first = safeArray(data.stations)[0] || {}
  const lat = core.toNumberOrNull(first.lat)
  const lng = core.toNumberOrNull(first.lng)
  return {
    station: {
      id: first.sId || base.id || base.stationId || '',
      name: first.sn || base.name || base.stationName || '',
      physicalStId: base.physicalStId || '',
      namesakeStId: base.namesakeStId || '',
      lat: lat !== null ? lat : base.lat,
      lng: lng !== null ? lng : base.lng,
      location:
        lng !== null && lat !== null
          ? `${lng},${lat}`
          : base.location || base.stationLocation || '',
      source: 'chelaile'
    },
    lines: safeArray(first.lines).map((line) => ({
      id: line.lineId || '',
      name: line.name || '',
      direction: core.toNumberOrNull(line.direction),
      startStop: line.startSn || '',
      endStop: line.endSn || '',
      firstTime: line.firstTime || '',
      lastTime: line.lastTime || '',
      price: line.price || '',
      targetOrder: core.toNumberOrNull(line.targetOrder),
      targetStationId: line.targetStationId || '',
      buses: safeArray(line.buses).map(normalizeBus)
    }))
  }
}

function boardResult(data, cachedAt, stale, error) {
  return {
    station: data.station,
    lines: data.lines || [],
    cachedAt: cachedAt || 0,
    stale: Boolean(stale),
    error: error || null
  }
}

function readWithFallback(primary, legacyKey, reader) {
  return primary.then((entry) => {
    if (entry) {
      return entry
    }
    return reader(legacyKey)
  })
}

export function getStopBoard(station, options) {
  const opts = options || {}
  const base = station || {}
  const physical = base.physicalStId || base.physical_st_id || ''
  const stationId = base.id || base.stationId || ''
  if (!physical && !stationId) {
    const error = new Error('缺少站点标识')
    error.type = 'invalid'
    return Promise.reject(error)
  }
  const cityId = cityOf(opts)
  const legacyKey = `stop|${physical || stationId}`
  const cacheKey = scopedKey(cityId, legacyKey)
  const params = { city_id: cityId }
  if (physical) {
    params.physical_st_id = physical
  }
  if (stationId) {
    params.station_id = stationId
  }

  const allowLegacy = Boolean(physical) || cityId === String(config.cityId)
  const loadCache = allowLegacy
    ? readWithFallback(store.getStopCache(cacheKey), legacyKey, store.getStopCache)
    : store.getStopCache(cacheKey)

  return loadCache.then((entry) => {
    const now = Date.now()
    const staticTs = entry && entry.staticTs ? entry.staticTs : 0
    const liveTs = entry && entry.liveTs ? entry.liveTs : 0
    if (!opts.force && entry && entry.data) {
      const age = now - (liveTs || staticTs)
      return boardResult(entry.data, liveTs || staticTs, age >= TTL.live)
    }
    return request('/v1/stops/detail', params, { timeout: SLOW_TIMEOUT, retry: SLOW_RETRY })
      .then((data) => {
        if (!Array.isArray(data.stations) || data.stations.length === 0) {
          const error = new Error('没有查到该站线路')
          error.type = 'api'
          throw error
        }
        const parsed = normalizeStopDetail(data, base)
        const ts = Date.now()
        return store
          .setStopCache(cacheKey, { staticTs: ts, liveTs: ts, data: parsed })
          .then(() => boardResult(parsed, ts, false))
      })
      .catch((error) => {
        if (entry && entry.data) {
          const ts = liveTs || staticTs
          return boardResult(entry.data, ts, true, error)
        }
        throw error
      })
  })
}

function normalizeLineDetail(data, lineId, direction) {
  const line = data.line || {}
  return {
    id: line.lineId || lineId || '',
    name: line.name || '',
    shortName: line.name || '',
    direction: core.toNumberOrNull(line.direction !== undefined ? line.direction : direction),
    startStop: line.startSn || '',
    endStop: line.endSn || '',
    startTime: line.firstTime || '',
    endTime: line.lastTime || '',
    intervalText: line.price || '',
    stationCount: core.toNumberOrNull(line.stationsNum),
    reverseDirection: core.toNumberOrNull(data.reverseDirection),
    targetOrderValue: core.toNumberOrNull(data.targetOrder),
    stops: safeArray(data.stations).map((station) => {
      const stopLat = core.toNumberOrNull(station.wgsLat)
      const stopLng = core.toNumberOrNull(station.wgsLng)
      return {
        id: station.sId || '',
        name: station.sn || '',
        seq: core.toNumber(station.order),
        physicalStId: station.physicalStId || '',
        namesakeStId: station.namesakeStId || '',
        lat: stopLat,
        lng: stopLng,
        location:
          stopLng !== null && stopLat !== null ? `${stopLng},${stopLat}` : ''
      }
    }),
    buses: safeArray(data.buses).map((bus) => ({
      busId: bus.busId || '',
      order: core.toNumberOrNull(bus.order),
      lat: core.toNumberOrNull(bus.lat),
      lng: core.toNumberOrNull(bus.lng),
      speed: core.toNumberOrNull(bus.speed),
      distance: core.toNumberOrNull(bus.distanceToWaitStn),
      capacity: core.toNumberOrNull(bus.capacity)
    }))
  }
}

function lineResult(data, cachedAt, stale, error) {
  const result = Object.assign({}, data)
  result.cachedAt = cachedAt || 0
  result.stale = Boolean(stale)
  result.error = error || null
  return result
}

export function getLineDetail(lineId, direction, options) {
  const opts = options || {}
  const id = String(lineId === undefined || lineId === null ? '' : lineId)
  if (!id) {
    const error = new Error('缺少线路标识')
    error.type = 'invalid'
    return Promise.reject(error)
  }
  const dir = core.toNumberOrNull(direction)
  const queryDirection = dir !== null ? dir : 0
  const cityId = cityOf(opts)
  const legacyKey = `line|${id}|${queryDirection}`
  const cacheKey = scopedKey(cityId, legacyKey)

  const loadCache =
    cityId === String(config.cityId)
      ? readWithFallback(store.getLineEntry(cacheKey), legacyKey, store.getLineEntry)
      : store.getLineEntry(cacheKey)

  return loadCache.then((entry) => {
    const now = Date.now()
    const staticTs = entry && entry.staticTs ? entry.staticTs : 0
    const liveTs = entry && entry.liveTs ? entry.liveTs : 0
    if (!opts.force && entry && entry.data) {
      const age = now - (liveTs || staticTs)
      return lineResult(entry.data, liveTs || staticTs, age >= TTL.live)
    }
    return request(
      '/v1/lines/detail',
      {
        city_id: cityId,
        line_id: id,
        direction: queryDirection
      },
      { timeout: SLOW_TIMEOUT, retry: SLOW_RETRY }
    )
      .then((data) => {
        const lineInfo = data.line || {}
        if (data.empty === true || (!lineInfo.lineId && !lineInfo.name)) {
          const error = new Error('该线路暂无线路数据')
          error.type = 'api'
          throw error
        }
        const parsed = normalizeLineDetail(data, id, queryDirection)
        const ts = Date.now()
        return store
          .setLineEntry(cacheKey, { staticTs: ts, liveTs: ts, data: parsed })
          .then(() => lineResult(parsed, ts, false))
      })
      .catch((error) => {
        if (entry && entry.data) {
          return lineResult(entry.data, liveTs || staticTs, true, error)
        }
        throw error
      })
  })
}

export default {
  setCityId,
  warmUp,
  getCities,
  searchAll,
  getStopBoard,
  getLineDetail
}
