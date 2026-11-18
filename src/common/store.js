import storage from '@blueos.storage.storage'
import config from './config'

const SAVED_KEY = 'bus_watch_saved_v1'
const CACHE_KEY = 'bus_watch_line_cache_v1'
const SEARCH_KEY = 'bus_watch_search_cache_v1'
const STOP_KEY = 'bus_watch_stop_cache_v1'
const BOARD_KEY = 'bus_watch_board_cache_v1'
const STATION_KEY = 'bus_watch_stations_v1'
const CITY_KEY = 'bus_watch_city_v1'
const CITIES_KEY = 'bus_watch_cities_v1'
const LIMITS = {
  search: 20,
  stop: 20,
  line: 30,
  board: 200
}

const state = {
  saved: [],
  loaded: false
}

const maps = {}
const loaders = {}
let stationsCache = null
let stationsLoading = null

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function read(key, fallback) {
  return new Promise((resolve) => {
    storage.get({
      key,
      success: (data) => {
        resolve(data === undefined || data === null ? fallback : data)
      },
      fail: () => resolve(fallback)
    })
  })
}

function write(key, value) {
  return new Promise((resolve) => {
    storage.set({
      key,
      value,
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

function loadMap(name, key) {
  if (maps[name]) {
    return Promise.resolve(maps[name])
  }
  if (loaders[name]) {
    return loaders[name]
  }
  const task = read(key, {}).then((data) => {
    maps[name] = isObject(data) ? data : {}
    delete loaders[name]
    return maps[name]
  })
  loaders[name] = task
  return task
}

function entryTime(entry) {
  if (!isObject(entry)) {
    return 0
  }
  const value = entry.ts || entry.liveTs || entry.staticTs || 0
  return Number(value) || 0
}

function prune(map, limit) {
  const keys = Object.keys(map)
  if (keys.length <= limit) {
    return map
  }
  keys.sort((left, right) => entryTime(map[right]) - entryTime(map[left]))
  const keep = {}
  keys.slice(0, limit).forEach((key) => {
    keep[key] = map[key]
  })
  return keep
}

function commit(name, key, map) {
  maps[name] = map
  return write(key, map)
}

export function loadSaved() {
  return read(SAVED_KEY, []).then((data) => {
    state.saved = Array.isArray(data) ? data : []
    state.loaded = true
    return state.saved
  })
}

// 多页面下每个页面各有独立的内存缓存，关注状态在别的页面改动后
// 需要让本页重新从存储读取
export function invalidateFollow() {
  state.loaded = false
  state.saved = []
  stationsCache = null
  stationsLoading = null
}

function ensureSaved() {
  if (state.loaded) {
    return Promise.resolve(state.saved)
  }
  return loadSaved()
}

export function saveLine(line) {
  return ensureSaved().then(() => {
    const key = `${line.stationId}_${line.lineId}`
    const exists = state.saved.some((item) => `${item.stationId}_${item.lineId}` === key)
    if (!exists) {
      state.saved = state.saved.concat([line])
    } else {
      state.saved = state.saved.map((item) => {
        if (`${item.stationId}_${item.lineId}` === key) {
          return Object.assign({}, item, line)
        }
        return item
      })
    }
    return write(SAVED_KEY, state.saved).then(() => state.saved)
  })
}

export function removeLine(stationId, lineId) {
  return ensureSaved().then(() => {
    state.saved = state.saved.filter(
      (item) =>
        !(
          String(item.stationId) === String(stationId) &&
          String(item.lineId) === String(lineId)
        )
    )
    return write(SAVED_KEY, state.saved).then(() => state.saved)
  })
}

function getLineCache() {
  return loadMap('line', CACHE_KEY)
}

function setLineCache(all) {
  return commit('line', CACHE_KEY, isObject(all) ? all : {})
}

export function getLineEntry(key) {
  return getLineCache().then((map) => map[key] || null)
}

export function setLineEntry(key, entry) {
  return getLineCache().then((map) => {
    const next = Object.assign({}, map)
    next[key] = entry
    return commit('line', CACHE_KEY, prune(next, LIMITS.line))
  })
}

export function getSearchCache(keyword) {
  return loadMap('search', SEARCH_KEY).then((map) => map[keyword] || null)
}

export function setSearchCache(keyword, data) {
  return loadMap('search', SEARCH_KEY).then((map) => {
    const next = Object.assign({}, map)
    next[keyword] = { ts: Date.now(), data: data }
    return commit('search', SEARCH_KEY, prune(next, LIMITS.search))
  })
}

export function getStopCache(key) {
  return loadMap('stop', STOP_KEY).then((map) => map[key] || null)
}

export function setStopCache(key, entry) {
  return loadMap('stop', STOP_KEY).then((map) => {
    const next = Object.assign({}, map)
    next[key] = entry
    return commit('stop', STOP_KEY, prune(next, LIMITS.stop))
  })
}

export function getBoardMap() {
  return loadMap('board', BOARD_KEY)
}

export function mergeBoardMap(entries) {
  return getBoardMap().then((map) => {
    const next = Object.assign({}, map, entries || {})
    return commit('board', BOARD_KEY, prune(next, LIMITS.board)).then(() => next)
  })
}

function stationKey(station) {
  if (!station) {
    return ''
  }
  return String(station.physicalStId || station.id || station.stationId || '')
}

function loadStations() {
  if (stationsCache) {
    return Promise.resolve(stationsCache)
  }
  if (stationsLoading) {
    return stationsLoading
  }
  stationsLoading = read(STATION_KEY, []).then((data) => {
    stationsCache = Array.isArray(data) ? data : []
    stationsLoading = null
    return stationsCache
  })
  return stationsLoading
}

export function getStations() {
  return loadStations().then((list) => list.slice())
}

export function isStationSaved(station) {
  const key = stationKey(station)
  if (!key) {
    return Promise.resolve(false)
  }
  return loadStations().then((list) => list.some((item) => stationKey(item) === key))
}

export function saveStation(station) {
  const key = stationKey(station)
  if (!key) {
    return Promise.resolve([])
  }
  return loadStations().then((list) => {
    const record = {
      id: station.id || station.stationId || '',
      name: station.name || station.stationName || '',
      physicalStId: station.physicalStId || '',
      namesakeStId: station.namesakeStId || '',
      location: station.location || station.stationLocation || '',
      lat: station.lat,
      lng: station.lng,
      cityId: station.cityId || '',
      source: station.source || 'chelaile',
      ts: Date.now()
    }
    const next = list.filter((item) => stationKey(item) !== key).concat([record])
    stationsCache = next
    return write(STATION_KEY, next).then(() => next)
  })
}

export function removeStation(station) {
  const key = stationKey(station)
  if (!key) {
    return Promise.resolve([])
  }
  return loadStations().then((list) => {
    const next = list.filter((item) => stationKey(item) !== key)
    stationsCache = next
    return write(STATION_KEY, next).then(() => next)
  })
}

export function getSelectedCity() {
  return read(CITY_KEY, null).then((data) => {
    if (data && data.cityId) {
      return {
        cityId: String(data.cityId),
        cityName: data.cityName || '',
        pinyin: data.pinyin || ''
      }
    }
    return {
      cityId: String(config.cityId),
      cityName: config.cityName,
      pinyin: ''
    }
  })
}

export function setSelectedCity(city) {
  const record = {
    cityId: String((city && city.cityId) || config.cityId),
    cityName: (city && (city.cityName || city.name)) || config.cityName,
    pinyin: (city && city.pinyin) || ''
  }
  return write(CITY_KEY, record).then(() => record)
}

export function getCitiesCache() {
  return read(CITIES_KEY, null).then((data) => {
    if (data && Array.isArray(data.cities)) {
      return data
    }
    return null
  })
}

export function setCitiesCache(cities) {
  const record = { ts: Date.now(), cities: Array.isArray(cities) ? cities : [] }
  return write(CITIES_KEY, record).then(() => record)
}

export default {
  loadSaved,
  invalidateFollow,
  saveLine,
  removeLine,
  getLineEntry,
  setLineEntry,
  getSearchCache,
  setSearchCache,
  getStopCache,
  setStopCache,
  getBoardMap,
  mergeBoardMap,
  getStations,
  isStationSaved,
  saveStation,
  removeStation,
  getSelectedCity,
  setSelectedCity,
  getCitiesCache,
  setCitiesCache
}
