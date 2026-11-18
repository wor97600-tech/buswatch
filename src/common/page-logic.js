// 页面共享逻辑：Home / Search / Station / Line / City 共用一份

import config from './config'
import store from './store'
import net from './net'
import core from './realtime-core'
import chelaile from './chelaile'
import router from '@blueos.app.appmanager.router'
import session from './session'

function currentPath() {
  try {
    const state = router.getState()
    return state && state.path ? String(state.path) : ''
  } catch (error) {
    return ''
  }
}

function readPayload(value) {
  if (!value) {
    return null
  }
  if (typeof value === 'object') {
    return value
  }
  try {
    return JSON.parse(String(value))
  } catch (error) {
    return null
  }
}

function inferMode(payload) {
  const data = readPayload(payload)
  if (!data) {
    return ''
  }
  if (data.context) {
    return 'line'
  }
  if (data.physicalStId || data.stationId || data.name) {
    return 'station'
  }
  return ''
}

function modeFromPath(path) {
  if (path.indexOf('/Search') >= 0) {
    return 'search'
  }
  if (path.indexOf('/City') >= 0) {
    return 'city'
  }
  if (path.indexOf('/Station') >= 0) {
    return 'station'
  }
  if (path.indexOf('/Line') >= 0) {
    return 'line'
  }
  return ''
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function formatTime(ts) {
  if (!ts) {
    return ''
  }
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function firstLastText(saved) {
  const start = saved && saved.firstTime
  const end = saved && saved.lastTime
  return start || end ? `首 ${start || '--'} · 末 ${end || '--'}` : '首末班待查询'
}

function routeText(line) {
  const start = line && line.startStop ? line.startStop : ''
  const end = line && line.endStop ? line.endStop : ''
  if (!start && !end) {
    return ''
  }
  return `${start} → ${end}`
}

function savedLineKey(stationId, lineId) {
  return `${stationId}_${lineId}`
}

function boardKey(saved) {
  const cityId = String((saved && saved.cityId) || config.legacyCityId)
  return `${cityId}_${saved.stationId}_${saved.lineId}`
}

function clipText(value, max) {
  const text = String(value === undefined || value === null ? '' : value)
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}…`
}

function buildSavedLine(station, line) {
  return {
    cityId: station.cityId || line.cityId || '',
    stationId: station.id || station.stationId || '',
    stationName: station.name || station.stationName || '',
    stationLocation: station.location || station.stationLocation || '',
    physicalStId: station.physicalStId || '',
    namesakeStId: station.namesakeStId || '',
    citycode: station.citycode || '',
    source: line.source || station.source || 'chelaile',
    lineId: line.id || line.lineId || '',
    lineName: line.name || line.lineName || '',
    shortName: line.shortName || line.name || line.lineName || '',
    startStop: line.startStop || '',
    endStop: line.endStop || '',
    direction: line.direction,
    targetOrder: line.targetOrder,
    firstTime: line.firstTime || '',
    lastTime: line.lastTime || '',
    price: line.price || ''
  }
}

const pageLogic = {
  data: {
    cityName: config.cityName,
    mode: '',
    headerTitle: '',
    loading: false,
    statusText: '',
    homeItems: [],
    keyword: '',
    searching: false,
    searchTip: '',
    searchResults: [],
    searchStations: [],
    station: null,
    stationLines: [],
    stationTip: '',
    stationUpdatedText: '',
    stationFav: false,
    poi: {},
    poiStations: [],
    lineError: '',
    line: {},
    lineName: '',
    lineFirstLastText: '',
    lineLiveText: '',
    lineLiveSub: '',
    lineFollowed: false,
    stops: [],
    currentSeq: 0,
    cityId: config.cityId,
    cityQuery: '',
    cityHint: '',
    cityError: '',
    cityList: [],
    citySearching: false,
    cityDownloading: false,
    cityCacheReady: false,
    swipeIndex: 1
  },

  onReady() {
    this._ready = true
    this.savedLines = []
    this.favStations = []
    this.lineContext = null
    this.mode = this.view || inferMode(this.payload) || modeFromPath(currentPath())
    if (!this.mode) {
      // 诊断：未能识别页面时把路径显示在标题，便于定位
      this.headerTitle = String(currentPath() || 'no-path')
    }
    // 先用默认城市同步渲染页面结构，避免等存储读取时出现空白
    this.cityId = String(config.cityId)
    this.cityName = config.cityName
    chelaile.setCityId(this.cityId)
    this.initView()
    const self = this
    store.getSelectedCity().then((city) => {
      const nextId = String(city.cityId)
      const nextName = city.cityName || config.cityName
      if (nextId === String(self.cityId) && nextName === self.cityName) {
        return
      }
      self.cityId = nextId
      self.cityName = nextName
      chelaile.setCityId(nextId)
      if (self.mode === '') {
        self.loadHome(true)
      }
    })
  },

  initView() {
    if (this.mode === '') {
      this.loadHome(true)
      return
    }
    if (this.mode === 'search') {
      this.headerTitle = '搜索'
      this.keyword = ''
      this.searchResults = []
      this.searchStations = []
      this.searchTip = ''
      this.searching = false
      return
    }
    if (this.mode === 'city') {
      this.headerTitle = '选择城市'
      this.cityQuery = ''
      this.cityList = []
      this.citySearching = false
      this.cityDownloading = false
      this.cityCacheReady = false
      this.cityHint = '点「下载城市缓存」获取全国城市'
      const self = this
      store.getCitiesCache().then((entry) => {
        if (entry && Array.isArray(entry.cities) && entry.cities.length > 0) {
          self.cityAll = entry.cities
          self.cityCacheReady = true
          self.cityHint = `城市缓存已就绪（${entry.cities.length} 个城市）`
          self.applyCityFilter()
        }
      })
      return
    }
    if (this.mode === 'station') {
      const station = readPayload(this.payload)
      if (!station) {
        this.stationTip = '缺少站点信息'
        return
      }
      this.station = station
      this.headerTitle = station.name || '公交站'
      this.stationLines = []
      this.stationTip = ''
      this.stationUpdatedText = ''
      this.loading = false
      const self = this
      store.isStationSaved(station).then((saved) => {
        self.stationFav = Boolean(saved)
      })
      store.loadSaved().then((list) => {
        self.savedLines = list || []
      })
      if (!station.physicalStId) {
        this.resolveStation(station)
      } else {
        this.loadStationBoard(station, false)
      }
      return
    }
    if (this.mode === 'line') {
      const payload = readPayload(this.payload)
      if (!payload || !payload.context) {
        this.lineError = '缺少线路信息'
        return
      }
      const context = payload.context
      this.lineContext = payload.from === 'search' ? null : context
      this.lineError = ''
      this.lineName = context.shortName || context.lineName || '线路'
      this.headerTitle = this.lineName
      this.lineFirstLastText = '正在加载...'
      this.lineLiveText = ''
      this.lineLiveSub = ''
      this.lineFollowed = false
      this.stops = []
      this.currentSeq = 0
      this.loading = false
      this._lineInit = context
      const page = this
      store.loadSaved().then((list) => {
        page.savedLines = list || []
        page.syncLineFollow()
      })
      if (this.lineContext) {
        this.loadLineLive()
      }
      this.loadLine(context, false)
    }
  },

  onShow() {
    if (!this._ready) {
      return
    }
    if (!this._shown) {
      this._shown = true
      return
    }
    // 关注状态可能在别的页面改动过，重新从存储读取
    store.invalidateFollow()
    if (this.mode === 'city') {
      return
    }
    const self = this
    store.getSelectedCity().then((city) => {
      const nextId = String(city.cityId)
      const changed = nextId !== String(self.cityId || '')
      if (changed) {
        self.cityId = nextId
        self.cityName = city.cityName || config.cityName
        chelaile.setCityId(nextId)
        if (self.mode === '') {
          self.loadHome(true)
          return
        }
        if (self.mode === 'search') {
          self.searchResults = []
          self.searchStations = []
          self.searchTip = `已切换到 ${self.cityName}，点「搜索」查询`
          return
        }
      }
      if (self.mode === 'station') {
        store.loadSaved().then((list) => {
          self.savedLines = list || []
        })
        return
      }
      if (self.mode === 'line') {
        store.loadSaved().then((list) => {
          self.savedLines = list || []
          self.syncLineFollow()
        })
        return
      }
      self.savedLines = self.savedLines || []
      self.favStations = self.favStations || []
      if (self.mode === '' && !self.loading) {
        self.loadHome(true)
      }
    })
  },

  onDestroy() {
    this.stopTimers()
  },

  onBackPress() {
    // 返回由系统页面栈处理
    return false
  },

  stopTimers() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    if (this._slowTimer) {
      clearTimeout(this._slowTimer)
      this._slowTimer = null
    }
    if (this._stationTimer) {
      clearTimeout(this._stationTimer)
      this._stationTimer = null
    }
    if (this._stationSlowTimer) {
      clearTimeout(this._stationSlowTimer)
      this._stationSlowTimer = null
    }
    this._stationToken = (this._stationToken || 0) + 1
  },

  goBack() {
    this.stopTimers()
    this.loading = false
    if (this.mode === 'poi') {
      this.mode = 'search'
      return
    }
    router.back()
  },

  openSearch() {
    this.stopTimers()
    router.push({ uri: '/pages/Search', params: { view: 'search' } })
  },

  onKeywordChange(event) {
    const raw = event && event.value !== undefined ? event.value : event
    if (typeof raw === 'string' || typeof raw === 'number') {
      this.keyword = String(raw)
    }
    if (this.searchTip === '请先输入关键词') {
      this.searchTip = ''
    }
  },

  readInputValue() {
    if (typeof this.$element !== 'function') {
      return ''
    }
    try {
      const el = this.$element('kw')
      return el && el.value !== undefined && el.value !== null ? String(el.value) : ''
    } catch (error) {
      return ''
    }
  },

  doSearch() {
    if (this.searching) {
      return
    }
    let keyword = String(this.keyword || '').trim()
    if (!keyword) {
      keyword = this.readInputValue().trim()
    }
    if (!keyword) {
      this.searchTip = '请先输入关键词'
      return
    }
    this.startSearch(keyword)
  },

  openCityPicker() {
    this.stopTimers()
    router.push({ uri: '/pages/City', params: { view: 'city' } })
  },

  loadCityList(force) {
    const self = this
    this.cityError = ''
    chelaile
      .getCities({ force: Boolean(force), hotOnly: true })
      .then((result) => {
        self.cityHot = result.cities || []
        self.cityHint = ''
        self.applyCityFilter()
        if (result.stale) {
          self.cityHint = `${self.cityHint} · 缓存`.trim()
        }
      })
      .catch((error) => {
        self.cityError = `城市列表加载失败：${net.describeError(error)}`
        self.cityHint = ''
      })
  },

  onCityQueryChange(event) {
    const raw = event && event.value !== undefined ? event.value : event
    if (typeof raw === 'string' || typeof raw === 'number') {
      this.cityQuery = String(raw)
    }
    if (!String(this.cityQuery || '').trim() || (this.cityAll && this.cityAll.length > 0)) {
      this.applyCityFilter()
    }
  },

  readCityInput() {
    if (typeof this.$element !== 'function') {
      return ''
    }
    try {
      const element = this.$element('citykw')
      return element && element.value ? String(element.value) : ''
    } catch (error) {
      return ''
    }
  },

  downloadCityCache() {
    if (this.cityDownloading) {
      return
    }
    const self = this
    this.cityDownloading = true
    this.cityError = ''
    this.cityHint = '正在下载城市缓存…'
    chelaile
      .getCities({ hotOnly: false, force: true })
      .then((result) => {
        self.cityDownloading = false
        self.cityAll = result.cities || []
        self._cityAllFallback = false
        self.cityCacheReady = self.cityAll.length > 0
        if (self.cityCacheReady) {
          self.cityHint = `城市缓存已就绪（${self.cityAll.length} 个城市）`
          self.applyCityFilter()
        } else {
          self.cityHint = '城市缓存为空'
        }
      })
      .catch((error) => {
        self.cityDownloading = false
        self.cityHint = ''
        self.cityError = `城市缓存下载失败：${net.describeError(error)}`
      })
  },

  searchCities() {
    if (this.citySearching) {
      return
    }
    const input = this.readCityInput().trim()
    if (input) {
      this.cityQuery = input
    }
    if (!String(this.cityQuery || '').trim()) {
      this.applyCityFilter()
      this.cityHint = '请先输入城市名或拼音'
      return
    }
    this.cityError = ''
    this.citySearching = true
    this.cityHint = '查找中…'
    const self = this
    const startedAt = Date.now()
    const apply = () => {
      self.citySearching = false
      self.applyCityFilter()
    }
    // 全量列表有本地缓存时几乎瞬时返回，保证「查找中」至少可见一段时间
    const finish = () => {
      const remain = 400 - (Date.now() - startedAt)
      if (remain > 0) {
        setTimeout(apply, remain)
      } else {
        apply()
      }
    }
    if (self.cityAll && self.cityAll.length > 0 && !self._cityAllFallback) {
      finish()
      return
    }
    chelaile
      .getCities({ hotOnly: false })
      .then((result) => {
        self.cityAll = result.cities || []
        self._cityAllFallback = false
        finish()
      })
      .catch((error) => {
        self.citySearching = false
        if (self.cityHot && self.cityHot.length > 0) {
          self.cityAll = self.cityHot.slice()
          self._cityAllFallback = true
          self.applyCityFilter()
          self.cityHint = `${self.cityHint} · 完整列表加载失败`.trim()
        } else {
          self.cityError = `城市查找失败：${net.describeError(error)}`
          self.cityHint = ''
        }
      })
  },

  applyCityFilter() {
    const typed = String(this.cityQuery || '').trim()
    const query = typed.toLowerCase()
    const build = (city) => ({
      key: `city_${city.cityId}`,
      cityId: city.cityId,
      cityName: city.cityName,
      pinyin: city.pinyin,
      hot: Boolean(city.hot),
      selected: String(city.cityId) === String(this.cityId)
    })
    if (!query) {
      const hot = (this.cityHot || []).slice(0, 12)
      this.cityList = hot.map(build)
      this.cityHint = hot.length ? '热门城市 · 输入城市名或拼音后点查找' : '输入城市名或拼音后点「查找」'
      return
    }
    const all = this.cityAll || []
    if (all.length === 0) {
      this.cityHint = '点「查找」查询城市'
      return
    }
    const matches = all.filter(
      (city) =>
        String(city.cityName).indexOf(query) >= 0 ||
        String(city.pinyin || '').toLowerCase().indexOf(query) >= 0
    )
    this.cityList = matches.slice(0, 20).map(build)
    this.cityHint = matches.length ? `找到 ${matches.length} 个城市` : '没有匹配的城市'
  },

  pickCity(item) {
    if (!item) {
      return
    }
    const city = {
      cityId: String(item.cityId),
      cityName: item.cityName,
      pinyin: item.pinyin || ''
    }
    chelaile.setCityId(city.cityId)
    store.setSelectedCity(city)
    this.stopTimers()
    router.back()
  },

  onSwiperChange(event) {
    const index = this.readSwiperIndex(event)
    if (index === 0) {
      this.handleSwipeBack()
      return
    }
    if (index === 1) {
      this.swipeIndex = 1
    }
  },

  onSwiperScroll(event) {
    const state = this.readSwiperScrollState(event)
    if (!state || state.index === undefined) {
      return
    }
    if (state.index === 0) {
      this.handleSwipeBack()
    }
  },

  readSwiperScrollState(event) {
    if (!event || typeof event !== 'object') {
      return null
    }
    const source = event.detail || event
    const index = source.index !== undefined ? Number(source.index) : undefined
    const offsetPct =
      source.offsetPct !== undefined
        ? Number(source.offsetPct)
        : source.offset !== undefined
          ? Number(source.offset)
          : undefined
    return {
      index: isNaN(index) ? undefined : index,
      offsetPct: isNaN(offsetPct) ? undefined : offsetPct
    }
  },

  readSwiperIndex(event) {
    let raw
    if (typeof event === 'number' || typeof event === 'string') {
      raw = event
    } else if (event) {
      raw =
        event.index !== undefined
          ? event.index
          : event.value !== undefined
            ? event.value
            : event.detail && event.detail.index !== undefined
              ? event.detail.index
              : undefined
    }
    if (raw === undefined || raw === null || raw === '') {
      return undefined
    }
    const index = Number(raw)
    return isNaN(index) ? undefined : index
  },

  onSwiperScrollTop() {
    if (this.mode !== '') {
      this.handleSwipeBack()
    }
  },

  handleSwipeBack() {
    const now = Date.now()
    if (this._swipeBackAt && now - this._swipeBackAt < 300) {
      return
    }
    this._swipeBackAt = now
    this.backToMain()
    if (this.mode !== '') {
      this.goBack()
    }
  },

  backToMain() {
    this.swipeIndex = 1
    if (typeof this.$element === 'function') {
      try {
        const swiper = this.$element('appSwiper')
        if (swiper && typeof swiper.swipeTo === 'function') {
          try {
            swiper.swipeTo({ index: 1 })
          } catch (error) {
            swiper.swipeTo(1)
          }
        }
      } catch (error) {
        // 仅依赖 index 绑定
      }
    }
  },

  localMatches(keyword) {
    const kw = core.normalizeStop(keyword)
    if (!kw) {
      return []
    }
    const items = []
    const seenStation = {}
    const seenLine = {}
    const hit = (name) => core.normalizeStop(name).indexOf(kw) >= 0

    const pushStation = (station, sub) => {
      const key = String(station.physicalStId || station.id || '')
      if (!key || seenStation[key]) {
        return
      }
      seenStation[key] = true
      items.push({
        key: `local_st_${key}`,
        kind: 'station',
        badge: '站点',
        badgeClass: 'badge-st',
        name: station.name || '',
        sub: sub,
        station: station
      })
    }

    ;(this.favStations || []).forEach((station) => {
      if (!hit(station.name)) {
        return
      }
      pushStation(
        {
          id: station.id,
          name: station.name,
          physicalStId: station.physicalStId,
          namesakeStId: station.namesakeStId,
          location: station.location,
          cityId: station.cityId || this.cityId,
          source: 'chelaile'
        },
        '本地关注 · 公交站'
      )
    })

    ;(this.savedLines || []).forEach((saved) => {
      if (hit(saved.stationName)) {
        pushStation(
          {
            id: saved.stationId,
            name: saved.stationName,
            physicalStId: saved.physicalStId,
            location: saved.stationLocation || saved.location || '',
            cityId: saved.cityId || this.cityId,
            source: 'chelaile'
          },
          '本地关注 · 公交站'
        )
      }
      const name = saved.shortName || saved.lineName || ''
      if (!hit(name)) {
        return
      }
      const key = savedLineKey(saved.stationId, saved.lineId)
      if (seenLine[key]) {
        return
      }
      seenLine[key] = true
      items.push({
        key: `local_ln_${key}`,
        kind: 'line',
        badge: '线路',
        badgeClass: 'badge-ln',
        name: name,
        sub: `本地关注 · ${routeText(saved) || saved.stationName || ''}`,
        line: {
          id: saved.lineId,
          lineName: saved.lineName,
          shortName: name,
          direction: saved.direction,
          startStop: saved.startStop,
          endStop: saved.endStop,
          source: saved.source || 'chelaile'
        }
      })
    })

    return items
  },

  startSearch(keyword) {
    if (this.searching) {
      return
    }
    this.searching = true
    this.searchTip = '搜索中...'
    this.searchResults = []
    this.searchStations = []
    const local = this.localMatches(keyword)
    if (local.length > 0) {
      this.searchResults = local
      this.searchTip = '本地关注结果 · 正在联网更新…'
    }
    this._searchToken = (this._searchToken || 0) + 1
    const token = this._searchToken
    const self = this

    this.stopTimers()
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      if (self._searchToken !== token || !self.searching) {
        return
      }
      self._searchToken = token + 1
      self.searching = false
      self.searchTip = '搜索超时，请检查网络后重试'
    }, 30000)
    this._slowTimer = setTimeout(() => {
      this._slowTimer = null
      if (self._searchToken !== token || !self.searching) {
        return
      }
      self.searchTip = '网络较慢，正在自动重试…'
    }, 6000)

    const done = (result, note) => {
      if (self._searchToken !== token) {
        return
      }
      self.stopTimers()
      self.searching = false
      self.applySearchResult(result, note)
    }

    const failed = (error) => {
      if (self._searchToken !== token) {
        return
      }
      self.stopTimers()
      self.searching = false
      const suffix = self.searchResults.length > 0 ? ' · 显示本地关注结果' : ''
      self.searchTip = `搜索失败：${net.describeError(error)}${suffix}`
    }

    if (!config.chelaile || !config.chelaile.enabled) {
      failed(new Error('车来了接口未启用'))
      return
    }

    chelaile
      .searchAll(keyword)
      .then((result) => {
        done(result, result.stale ? `缓存结果 · ${formatTime(result.cachedAt)}` : '')
      })
      .catch((error) => {
        failed(error)
      })
  },

  applySearchResult(result, note) {
    const items = []
    const pois = result.pois || []
    const stations = result.stations || []
    const lines = result.lines || []

    pois.forEach((poi, index) => {
      items.push({
        key: `poi_${index}_${poi.name || ''}`,
        kind: 'poi',
        badge: '地点',
        badgeClass: 'badge-poi',
        name: poi.name || '未命名地点',
        sub: clipText([poi.tag, poi.address].filter((part) => part).join(' · '), 26) || '地点',
        poi: poi
      })
    })

    stations.forEach((station, index) => {
      items.push({
        key: `st_${index}_${station.id || ''}`,
        kind: 'station',
        badge: '站点',
        badgeClass: 'badge-st',
        name: station.name || '未命名站点',
        sub: '公交站',
        station: station
      })
    })

    lines.forEach((line, index) => {
      items.push({
        key: `ln_${index}_${line.key || line.id || ''}`,
        kind: 'line',
        badge: '线路',
        badgeClass: 'badge-ln',
        name: line.shortName || line.lineName || '线路',
        sub: routeText(line) || '公交线路',
        line: line
      })
    })

    this.searchStations = stations
    this.searchResults = items
    if (items.length === 0) {
      this.searchTip = '没有找到结果，换个关键词试试'
    } else {
      this.searchTip = note || ''
    }
  },

  pickResult(item) {
    if (!item) {
      return
    }
    if (item.kind === 'poi') {
      this.openPoi(item.poi)
      return
    }
    if (item.kind === 'station') {
      this.openStation(item.station, 'search')
      return
    }
    if (item.kind === 'line') {
      this.openLineFromSearch(item.line)
    }
  },

  openPoi(poi) {
    this.stopTimers()
    this.poi = poi || {}
    this.poiStations = this.searchResults.filter((item) => item.kind === 'station')
    this.mode = 'poi'
    this.headerTitle = (poi && poi.name) || '地点'
  },

  searchPoiStations() {
    const keyword = this.poi && this.poi.name ? this.poi.name : ''
    if (!keyword) {
      return
    }
    this.mode = 'search'
    this.headerTitle = '搜索'
    this.keyword = keyword
    this.searchResults = []
    this.searchTip = ''
    this.startSearch(keyword)
  },

  openStation(station, from) {
    this.stopTimers()
    if (!station) {
      return
    }
    const current = Object.assign({}, station, {
      cityId: station.cityId || this.cityId
    })
    router.push({ uri: '/pages/Station', params: { view: 'station', payload: JSON.stringify(current) } })
  },

  resolveStation(station) {
    const self = this
    const name = station.name || station.stationName || ''
    if (!name) {
      this.stationTip = '该站点缺少标识，请返回重新搜索'
      return
    }
    this.loading = true
    this.stationTip = '正在车来了匹配该站点...'
    const cityId = String(station.cityId || this.cityId)
    chelaile
      .searchAll(name, { cityId: cityId })
      .then((result) => {
        if (self.station !== station) {
          return
        }
        const wanted = core.normalizeStop(name)
        const exact = result.stations.filter(
          (item) => core.normalizeStop(item.name) === wanted
        )
        const pool = exact.length > 0 ? exact : result.stations
        const hit = pool[0]
        if (!hit || !hit.physicalStId) {
          self.loading = false
          self.stationTip = '车来了没有匹配到该站点，请返回重新搜索'
          return
        }
        const current = Object.assign({}, hit, { cityId: cityId })
        self.station = current
        self.headerTitle = hit.name || self.headerTitle
        store.isStationSaved(current).then((saved) => {
          self.stationFav = Boolean(saved)
        })
        self.loadStationBoard(current, false)
      })
      .catch((error) => {
        if (self.station !== station) {
          return
        }
        self.loading = false
        self.stationTip = `站点匹配失败：${net.describeError(error)}`
      })
  },

  loadStationBoard(station, force) {
    const self = this
    if (this._stationTimer) {
      clearTimeout(this._stationTimer)
    }
    const token = (this._stationToken || 0) + 1
    this._stationToken = token
    this.loading = true
    this.stationTip = '加载途经线路...'
    if (this._stationSlowTimer) {
      clearTimeout(this._stationSlowTimer)
    }
    this._stationSlowTimer = setTimeout(() => {
      self._stationSlowTimer = null
      if (self._stationToken === token && self.loading) {
        self.stationTip = '网络较慢，仍在加载…'
      }
    }, 6000)
    this._stationTimer = setTimeout(() => {
      self._stationTimer = null
      if (self._stationToken === token && self.loading) {
        self.loading = false
        self.stationTip = '加载超时，点右上「刷新」重试'
      }
    }, 25000)
    const done = () => {
      if (self._stationTimer) {
        clearTimeout(self._stationTimer)
        self._stationTimer = null
      }
      if (self._stationSlowTimer) {
        clearTimeout(self._stationSlowTimer)
        self._stationSlowTimer = null
      }
    }
    chelaile
      .getStopBoard(station, {
        force: Boolean(force),
        cityId: station.cityId || this.cityId
      })
      .then((board) => {
        if (self._stationToken !== token) {
          return
        }
        done()
        self.loading = false
        self.applyStationBoard(board)
      })
      .catch((error) => {
        if (self._stationToken !== token) {
          return
        }
        done()
        self.loading = false
        self.stationTip = `线路加载失败：${net.describeError(error)}`
      })
  },

  stationFollowFlags() {
    const saved = this.savedLines || []
    return (line) => {
      const station = this.station || {}
      const key = savedLineKey(station.id, line.id)
      return saved.some((item) => savedLineKey(item.stationId, item.lineId) === key)
    }
  },

  applyStationBoard(board) {
    this.station = Object.assign({}, this.station, {
      id: board.station.id || this.station.id,
      name: board.station.name || this.station.name,
      location: board.station.location || this.station.location,
      physicalStId: board.station.physicalStId || this.station.physicalStId
    })
    const isFollowed = this.stationFollowFlags()
    const lines = board.lines.map((line) => {
      const pick = core.selectBus(line, { targetOrder: line.targetOrder })
      const text = core.arrivalText(pick)
      const item = {
        id: line.id,
        name: line.name,
        shortName: line.name,
        direction: line.direction,
        startStop: line.startStop,
        endStop: line.endStop,
        firstTime: line.firstTime,
        lastTime: line.lastTime,
        price: line.price,
        targetOrder: line.targetOrder,
        source: 'chelaile',
        etaText: text.text,
        hasEta: text.live,
        dirText: routeText(line) || '公交线路',
        timeText:
          line.firstTime || line.lastTime
            ? `首 ${line.firstTime || '--'} · 末 ${line.lastTime || '--'}`
            : '',
        followed: isFollowed({ id: line.id })
      }
      item.key = `${board.station.id}_${line.id}`
      return item
    })

    this.stationLines = lines
    this.stationTip = lines.length === 0 ? '这个站暂时没有查到线路' : ''
    this.stationUpdatedText = board.cachedAt
      ? `${board.stale ? '缓存 · ' : ''}${formatTime(board.cachedAt)} 更新`
      : ''
    if (board.error) {
      this.stationUpdatedText += ' · 网络异常，显示缓存'
    }
    this.headerTitle = this.station.name || this.headerTitle
  },

  refreshStationFlags() {
    const saved = this.savedLines || []
    const station = this.station || {}
    this.stationLines = this.stationLines.map((line) => {
      const key = savedLineKey(station.id, line.id)
      const followed = saved.some(
        (item) => savedLineKey(item.stationId, item.lineId) === key
      )
      return Object.assign({}, line, { followed: followed })
    })
  },

  toggleFollowLine(item) {
    if (!item || !this.station) {
      return
    }
    const station = this.station
    const key = savedLineKey(station.id, item.id)
    const saved = this.savedLines || []
    const exists = saved.some(
      (entry) => savedLineKey(entry.stationId, entry.lineId) === key
    )
    const self = this
    const apply = (list) => {
      self.savedLines = list || []
      self.refreshStationFlags()
      self.loadHome(false)
    }
    if (exists) {
      store.removeLine(station.id, item.id).then(apply)
      return
    }
    store.saveLine(
      buildSavedLine(Object.assign({}, station, { cityId: station.cityId || this.cityId }), item)
    ).then(apply)
  },

  toggleFollowStation() {
    const station = this.station
    if (!station) {
      return
    }
    if (!station.physicalStId) {
      this.stationTip = '该站点缺少站点标识，无法关注'
      return
    }
    const self = this
    if (this.stationFav) {
      store.removeStation(station).then(() => {
        self.stationFav = false
        self.loadHome(false)
      })
      return
    }
    store.saveStation(Object.assign({}, station, { cityId: station.cityId || this.cityId })).then(() => {
      self.stationFav = true
      self.loadHome(false)
    })
  },

  openLineFromStation(item) {
    const station = this.station || {}
    this.openLine(
      {
        stationId: station.id || '',
        stationName: station.name || '',
        stationLocation: station.location || '',
        physicalStId: station.physicalStId || '',
        cityId: station.cityId || this.cityId,
        source: item.source || 'chelaile',
        lineId: item.id,
        lineName: item.name,
        shortName: item.shortName,
        direction: item.direction,
        startStop: item.startStop,
        endStop: item.endStop,
        targetOrder: item.targetOrder
      },
      'station'
    )
  },

  openLineFromSearch(line) {
    this.openLine(
      {
        stationId: '',
        stationName: '',
        stationLocation: '',
        physicalStId: '',
        cityId: line.cityId || this.cityId,
        source: line.source || 'chelaile',
        lineId: line.id,
        lineName: line.lineName || line.name,
        shortName: line.shortName || line.lineName || line.name,
        direction: line.direction,
        startStop: line.startStop,
        endStop: line.endStop,
        targetOrder: null
      },
      'search'
    )
  },

  openLine(context, from) {
    this.stopTimers()
    if (!context) {
      return
    }
    router.push({
      uri: '/pages/Line',
      params: { view: 'line', payload: JSON.stringify({ context: context, from: from || '' }) }
    })
  },

  loadLine(context, force) {
    const self = this
    this.loading = true
    chelaile
      .getLineDetail(context.lineId, context.direction, {
        force: Boolean(force),
        cityId: context.cityId || this.cityId
      })
      .then((detail) => {
        self.loading = false
        self.applyLineDetail(detail, context)
      })
      .catch((error) => {
        self.loading = false
        self.lineError = `线路详情加载失败：${net.describeError(error)}`
      })
  },

  applyLineDetail(detail, context) {
    const lineName = detail.name || (context && context.lineName) || ''
    this.lineName = lineName
    if (!this.lineContext) {
      this.headerTitle = this.lineName || this.headerTitle
    }
    this.lineFirstLastText =
      detail.startTime || detail.endTime
        ? `首班 ${detail.startTime || '--'} · 末班 ${detail.endTime || '--'}`
        : '首末班时间待查询'

    const ctx = this.lineContext
    let marked = false
    let currentSeq = 0
    const stops = (detail.stops || []).map((stop, index) => {
      let active = false
      if (ctx && !marked) {
        const idMatch = ctx.stationId && String(stop.id) === String(ctx.stationId)
        const nameMatch =
          ctx.stationName &&
          core.normalizeStop(stop.name) === core.normalizeStop(ctx.stationName)
        if (idMatch || nameMatch) {
          active = true
          marked = true
          currentSeq = stop.seq
        }
      }
      return {
        key: `${stop.id}_${stop.seq || index}`,
        id: stop.id,
        name: stop.name,
        seq: stop.seq || index + 1,
        physicalStId: stop.physicalStId || '',
        namesakeStId: stop.namesakeStId || '',
        location: stop.location || '',
        active: active
      }
    })

    this.stops = stops
    this.currentSeq = currentSeq
    if (ctx && marked) {
      ctx.targetOrder = currentSeq
      const matchedStop = stops.filter((stop) => stop.active)[0]
      if (matchedStop) {
        ctx.physicalStId = ctx.physicalStId || matchedStop.physicalStId
        ctx.stationLocation = ctx.stationLocation || matchedStop.location
      }
    }

    this.line = detail
    this.syncLineFollow()
    if (!this.lineContext) {
      this.loadLineLive()
    }
  },

  syncLineFollow() {
    const ctx = this.lineContext
    const lineId = (ctx && ctx.lineId) || (this.line && this.line.id) || ''
    const stationId = ctx ? ctx.stationId : ''
    const saved = this.savedLines || []
    this.lineFollowed = Boolean(
      stationId &&
        lineId &&
        saved.some(
          (item) =>
            String(item.stationId) === String(stationId) &&
            String(item.lineId) === String(lineId)
        )
    )
  },

  selectStop(stop) {
    if (!stop) {
      return
    }
    const line = this.line || {}
    const context = {
      stationId: stop.id,
      stationName: stop.name,
      stationLocation: stop.location || '',
      physicalStId: stop.physicalStId || '',
      cityId: (this.lineContext && this.lineContext.cityId) || this.cityId,
      source: 'chelaile',
      lineId: line.id || (this._lineInit && this._lineInit.lineId) || '',
      lineName: line.name || '',
      shortName: line.name || '',
      direction: line.direction,
      startStop: line.startStop,
      endStop: line.endStop,
      targetOrder: stop.seq
    }
    this.lineContext = context
    this.currentSeq = stop.seq
    this.stops = this.stops.map((item) =>
      Object.assign({}, item, { active: String(item.id) === String(stop.id) })
    )
    this.syncLineFollow()
    this.loadLineLive()
  },

  loadLineLive() {
    const ctx = this.lineContext
    const detail = this.line || {}
    const self = this

    if (ctx && ctx.physicalStId) {
      chelaile
        .getStopBoard(
          {
            id: ctx.stationId,
            name: ctx.stationName,
            physicalStId: ctx.physicalStId,
            location: ctx.stationLocation
          },
          { cityId: ctx.cityId || this.cityId }
        )
        .then((board) => {
          if (self.lineContext !== ctx) {
            return
          }
          const line = core.findLine(board.lines, {
            lineId: ctx.lineId,
            lineName: ctx.lineName,
            shortName: ctx.shortName,
            direction: ctx.direction,
            endStop: ctx.endStop
          })
          const pick = line ? core.selectBus(line, ctx) : null
          const text = core.arrivalText(pick)
          const note = board.cachedAt
            ? `${board.stale ? ' · 缓存 ' : ' · '}${formatTime(board.cachedAt)}`
            : ''
          self.lineLiveText = text.live
            ? `${text.text} 到 ${ctx.stationName || '本站'}`
            : '暂无在途车辆'
          self.lineLiveSub =
            (core.busSummary(pick) || (line ? `开往 ${line.endStop || ''}` : '')) + note
        })
        .catch((error) => {
          if (self.lineContext !== ctx) {
            return
          }
          self.lineLiveText = '实时数据不可用'
          self.lineLiveSub = `${net.describeError(error)} · 点右上刷新重试`
        })
      return
    }

    if (detail && Array.isArray(detail.buses) && detail.buses.length > 0) {
      const orders = detail.buses
        .map((bus) => (bus.order === null || bus.order === undefined ? null : bus.order))
        .filter((order) => order !== null)
      orders.sort((left, right) => left - right)
      this.lineLiveText = `在途 ${detail.buses.length} 辆`
      this.lineLiveSub = orders.length > 0 ? `最近一辆在第 ${orders[0]} 站 · 点选站点看实时` : '点选站点查看到站'
      return
    }

    this.lineLiveText = detail && detail.stops && detail.stops.length > 0 ? '点选下方站点查看实时到站' : '暂无实时数据'
    this.lineLiveSub = '点右上刷新重试'
  },

  toggleFollowLineCurrent() {
    const ctx = this.lineContext
    if (!ctx || !ctx.stationId) {
      this.lineLiveSub = '先点选一个站点，再关注该站线路'
      return
    }
    const self = this
    const exists = (this.savedLines || []).some(
      (item) =>
        String(item.stationId) === String(ctx.stationId) &&
        String(item.lineId) === String(ctx.lineId)
    )
    const station = {
      id: ctx.stationId,
      name: ctx.stationName,
      location: ctx.stationLocation,
      physicalStId: ctx.physicalStId,
      namesakeStId: ctx.namesakeStId,
      cityId: ctx.cityId || this.cityId,
      source: ctx.source
    }
    const line = {
      id: ctx.lineId,
      name: ctx.lineName,
      shortName: ctx.shortName || ctx.lineName,
      startStop: ctx.startStop,
      endStop: ctx.endStop,
      direction: ctx.direction,
      targetOrder: ctx.targetOrder,
      firstTime: this.line ? this.line.startTime : '',
      lastTime: this.line ? this.line.endTime : '',
      price: this.line ? this.line.intervalText : '',
      source: ctx.source
    }
    const apply = (list) => {
      self.savedLines = list || []
      self.syncLineFollow()
      self.loadHome(false)
    }
    if (exists) {
      store.removeLine(ctx.stationId, ctx.lineId).then(apply)
      return
    }
    store.saveLine(buildSavedLine(station, line)).then(apply)
  },

  refreshCurrent() {
    if (this.loading) {
      return
    }
    if (this.mode === 'station' && this.station) {
      if (!this.station.physicalStId) {
        this.stationTip = '该站点缺少实时数据源'
        return
      }
      this.loadStationBoard(this.station, true)
      return
    }
    if (this.mode === 'line') {
      const context = this.lineContext || this._lineInit
      this.lineError = ''
      this.loadLine(context, true)
    }
  },

  refreshAll() {
    if (this.loading) {
      return
    }
    this.loading = true
    this.statusText = '正在刷新...'
    this.loadHome(true)
  },

  loadHome(withNetwork) {
    const self = this
    Promise.all([store.loadSaved(), store.getStations(), store.getBoardMap()])
      .then((result) => {
        self.savedLines = result[0] || []
        self.favStations = result[1] || []
        const board = result[2] || {}
        self.renderHome(board)
        const current = self.savedLines
        if (withNetwork && current.length > 0) {
          self.loading = true
          self.statusText = '正在获取实时到站…'
          self.refreshArrivals(current)
        } else {
          self.loading = false
          if (withNetwork) {
            chelaile.warmUp()
          }
        }
      })
      .catch(() => {
        self.loading = false
        self.statusText = '读取本地数据失败'
      })
  },

  renderHome(board) {
    const stats = board || {}
    const items = []
    const saved = this.savedLines || []
    const favs = this.favStations || []
    let latest = 0

    if (favs.length > 0) {
      items.push({ kind: 'header', key: 'header_station', text: '关注站点' })
      favs.forEach((station) => {
        items.push({
          kind: 'station',
          key: `fav_${station.physicalStId || station.id}`,
          name: station.name || '未命名站点',
          station: {
            id: station.id,
            name: station.name,
            physicalStId: station.physicalStId,
            namesakeStId: station.namesakeStId,
            location: station.location,
            cityId: station.cityId || '',
            source: station.source || 'chelaile'
          }
        })
      })
    }

    if (saved.length > 0) {
      items.push({ kind: 'header', key: 'header_line', text: '关注线路' })
      saved.forEach((item) => {
        const card = this.buildCard(item, stats)
        if (card.cachedAt > latest) {
          latest = card.cachedAt
        }
        items.push(Object.assign({ kind: 'line' }, card))
      })
    }

    this.homeItems = items
    if (latest > 0) {
      this.statusText = `${formatTime(latest)} 缓存 · 点刷新更新`
    } else {
      this.statusText = '点右上「刷新」获取实时到站'
    }
    this.loading = false
  },

  buildCard(saved, board) {
    const key = boardKey(saved)
    const entry = board ? board[key] : null
    const item = entry && entry.item ? entry.item : null
    const legacy = !saved.physicalStId
    let etaText = legacy ? '需重新关注' : '点刷新'
    let etaSub = legacy ? '旧版关注 · 请重新搜索站点并关注' : firstLastText(saved)
    let hasRealtime = false
    let cachedAt = 0
    if (item) {
      etaText = item.etaText || '暂无在途车辆'
      etaSub = item.etaSub || firstLastText(saved)
      hasRealtime = Boolean(item.hasRealtime)
      cachedAt = entry.ts || 0
      if (entry.ts) {
        etaSub = `${etaSub}${etaSub ? ' · ' : ''}${formatTime(entry.ts)}${entry.stale ? ' 缓存' : ''}`
      }
    }
    return {
      key: key,
      cityId: saved.cityId || '',
      stationId: saved.stationId,
      stationName: saved.stationName || '',
      stationLocation: saved.stationLocation || saved.location || '',
      physicalStId: saved.physicalStId || '',
      source: saved.source || 'chelaile',
      lineId: saved.lineId,
      lineName: saved.lineName || '',
      shortName: saved.shortName || saved.lineName || '',
      startStop: saved.startStop || '',
      endStop: saved.endStop || '',
      direction: saved.direction,
      targetOrder: saved.targetOrder,
      intervalText: saved.price || '',
      etaText: etaText,
      etaSub: etaSub,
      hasRealtime: hasRealtime,
      cachedAt: cachedAt
    }
  },

  refreshArrivals(savedLines) {
    const self = this
    self
      .refreshCheLaileArrivals(savedLines)
      .then((stats) => {
        return store.getBoardMap().then((board) => {
          self.renderHome(board)
          self.loading = false
          if (stats.updatedAt) {
            self.statusText = `${formatTime(stats.updatedAt)} 更新${
              stats.failed ? ' · 部分失败' : ''
            }`
          } else if (stats.failed) {
            self.statusText = '网络不可用 · 显示缓存'
          } else {
            self.statusText = '暂无实时数据 · 显示静态信息'
          }
        })
      })
      .catch(() => {
        self.loading = false
        self.statusText = '刷新失败 · 显示缓存'
        self.loadHome(false)
      })
  },

  refreshCheLaileArrivals(savedLines) {
    const usable = savedLines.filter((item) => item.physicalStId)
    if (usable.length === 0) {
      return Promise.resolve({ found: false, failed: false, updatedAt: 0 })
    }
    const groups = {}
    usable.forEach((item) => {
      const cityId = String(item.cityId || config.legacyCityId)
      const key = `${cityId}|${item.physicalStId || item.stationId}`
      if (!groups[key]) {
        groups[key] = {
          cityId: cityId,
          station: {
            id: item.stationId,
            name: item.stationName,
            physicalStId: item.physicalStId,
            location: item.stationLocation || item.location || ''
          },
          lines: []
        }
      }
      groups[key].lines.push(item)
    })

    const updates = {}
    let found = false
    let failed = false
    let updatedAt = 0

    const tasks = Object.keys(groups).map((key) => {
      const group = groups[key]
      return chelaile
        .getStopBoard(group.station, { force: true, cityId: group.cityId })
        .then((board) => {
          if (board.error) {
            failed = true
          }
          if (board.cachedAt > updatedAt) {
            updatedAt = board.cachedAt
          }
          group.lines.forEach((saved) => {
            const line = core.findLine(board.lines, saved)
            const pick = line ? core.selectBus(line, saved) : null
            const text = core.arrivalText(pick)
            if (pick) {
              found = true
            }
            updates[boardKey(saved)] = {
              ts: board.cachedAt || Date.now(),
              stale: Boolean(board.stale),
              item: {
                etaText: text.text,
                etaSub: core.busSummary(pick) || firstLastText(saved),
                hasRealtime: text.live
              }
            }
          })
        })
        .catch(() => {
          failed = true
        })
    })

    return Promise.all(tasks)
      .then(() => store.mergeBoardMap(updates))
      .then(() => ({ found: found, failed: failed, updatedAt: updatedAt }))
  },

  onHomeTap(item) {
    if (!item) {
      return
    }
    if (item.kind === 'station') {
      this.openStation(item.station, 'home')
      return
    }
    if (item.kind === 'line') {
      this.openLine(
        {
          stationId: item.stationId,
          stationName: item.stationName,
          stationLocation: item.stationLocation,
          physicalStId: item.physicalStId,
          cityId: item.cityId || this.cityId,
          source: item.source,
          lineId: item.lineId,
          lineName: item.lineName,
          shortName: item.shortName,
          direction: item.direction,
          startStop: item.startStop,
          endStop: item.endStop,
          targetOrder: item.targetOrder
        },
        'home'
      )
    }
  }
}

export default pageLogic
