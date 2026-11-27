const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function loadCityHelper() {
  const file = path.join(root, 'src/common/city-search.js')
  assert.ok(fs.existsSync(file), '缺少 city-search.js：城市搜索应有可测试的纯逻辑')
  const source = read('src/common/city-search.js').replace(/\bexport\s+function\s+/g, 'function ')
  const context = { module: { exports: {} }, exports: {} }
  vm.runInNewContext(
    `${source}\nmodule.exports = { filterCities, beginCitySearch }\n`,
    context,
    { filename: file }
  )
  return context.module.exports
}

function loadConfig() {
  const source = read('src/common/config.js').replace(/\bexport\s+default\s+config\s*$/, 'module.exports = config')
  const context = { module: { exports: {} }, exports: {} }
  vm.runInNewContext(source, context, { filename: 'config.js' })
  return context.module.exports
}

function methodBody(source, name, nextName) {
  const signature = new RegExp(`  ${name}\\([^)]*\\)`).exec(source)
  assert.ok(signature, `找不到 ${name}`)
  const body = source.slice(signature.index)
  const next = new RegExp(`\\n  ${nextName}\\(`).exec(body)
  assert.ok(next, `找不到 ${name} 的结束位置 ${nextName}`)
  return body.slice(0, next.index)
}

const cities = [
  { cityId: '1', cityName: '海口', pinyin: 'haikou' },
  { cityId: '2', cityName: '北京', pinyin: 'beijing' },
  { cityId: '3', cityName: '杭州', pinyin: 'hangzhou' }
]

const tests = []
function test(name, fn) {
  tests.push({ name, fn })
}

test('城市搜索支持中文和大小写不敏感的拼音匹配', () => {
  const { filterCities } = loadCityHelper()
  assert.deepStrictEqual(filterCities(cities, '海口').map((item) => item.cityId), ['1'])
  assert.deepStrictEqual(filterCities(cities, 'HANG').map((item) => item.cityId), ['3'])
  assert.deepStrictEqual(filterCities(cities, '不存在'), [])
})

test('点击搜索立即进入查找中状态', () => {
  const { beginCitySearch } = loadCityHelper()
  const local = beginCitySearch('北京', cities, false)
  assert.strictEqual(local.searching, true)
  assert.strictEqual(local.hint, '查找中…')
  assert.strictEqual(local.needsNetwork, false)
  assert.deepStrictEqual(local.matches.map((item) => item.cityId), ['2'])

  const remote = beginCitySearch('杭州', [], false)
  assert.strictEqual(remote.searching, true)
  assert.strictEqual(remote.hint, '查找中…')
  assert.strictEqual(remote.needsNetwork, true)
})

test('完整本地列表无结果时不再发起重复网络请求', () => {
  const { beginCitySearch } = loadCityHelper()
  const result = beginCitySearch('不存在', cities, true)
  assert.strictEqual(result.searching, true)
  assert.strictEqual(result.hint, '查找中…')
  assert.strictEqual(result.needsNetwork, false)
  assert.deepStrictEqual(result.matches, [])
})

test('弱网请求预算被收敛，完整城市列表不再串行重试', () => {
  const config = loadConfig()
  const c = config.chelaile
  assert.ok(c.timeout <= 8000, `普通请求超时过长：${c.timeout}`)
  assert.ok(c.retry <= 1, `普通请求重试过多：${c.retry}`)
  assert.ok(c.slowTimeout <= 10000, `站点/线路超时过长：${c.slowTimeout}`)
  assert.strictEqual(c.slowRetry, 0, '站点/线路不应串行重试')
  assert.ok(c.searchTimeout <= 6000, `搜索超时过长：${c.searchTimeout}`)
  assert.strictEqual(c.searchRetry, 0, '搜索不应串行重试')
  assert.ok(c.cityTimeout <= 8000, `城市列表超时过长：${c.cityTimeout}`)
  assert.strictEqual(c.cityRetry, 0, '城市列表不应串行重试')
})

test('进入城市页只渲染本地界面，不自动请求城市或热门列表', () => {
  const source = read('src/common/page-logic.js')
  const body = methodBody(source, 'initCityView', 'onShow')
  assert.ok(body.includes("this.cityHint = '输入城市名或拼音后点「搜索」'"), '城市页首屏没有明确操作提示')
  assert.ok(body.includes('setTimeout'), '本地缓存读取没有推迟到首帧之后')
  assert.ok(!body.includes('chelaile'), '进入城市页仍在触发网络请求')
  assert.ok(!body.includes('loadCityList'), '进入城市页仍在加载热门城市')
  assert.ok(!body.includes('cityHot'), '城市页仍保留热门城市状态')
  assert.ok(!body.includes('cityAllFallback'), '城市页仍保留热门城市回退状态')
})

test('城市搜索先同步显示查找中，再读取缓存或联网', () => {
  const source = read('src/common/page-logic.js')
  const body = methodBody(source, 'searchCities', 'applyCityFilter')
  assert.ok(!/400\s*-/.test(body), '城市搜索仍在人为等待 400ms')
  assert.ok(
    body.indexOf("this.citySearching = true") >= 0 &&
      body.indexOf("this.cityHint = '查找中…'") >= 0,
    '城市搜索没有同步设置查找中状态'
  )
  assert.ok(body.indexOf("this.cityHint = '查找中…'") < body.indexOf('chelaile'), '查找中状态应在任何网络调用之前设置')
  assert.ok(body.indexOf('this.cityList = []') < body.indexOf('chelaile'), '旧结果应在状态切换时立即清空')
  assert.ok(!body.includes('cityHot'), '城市搜索仍在回退热门城市')
  assert.ok(!body.includes('hotOnly: true'), '城市搜索仍在请求热门城市')
  assert.ok(!/,\s*30000\s*\)/.test(source), '搜索仍有 30 秒硬超时')
  assert.ok(!/,\s*25000\s*\)/.test(source), '站点仍有 25 秒硬超时')
})

test('城市搜索先让忙碌态渲染，再执行检索并保证短暂可见', () => {
  const source = read('src/common/page-logic.js')
  const body = methodBody(source, 'searchCities', 'applyCityFilter')
  assert.ok(source.includes('SEARCH_START_DELAY_MS'), '缺少检索启动延时，忙碌态可能来不及渲染')
  assert.ok(source.includes('SEARCH_MIN_FEEDBACK_MS'), '缺少最小反馈时长，快速结果会覆盖查找中状态')
  assert.ok(body.includes('setTimeout(runCitySearch, SEARCH_START_DELAY_MS)'), '城市检索仍在点击事件中同步执行')
  assert.ok(body.includes('SEARCH_MIN_FEEDBACK_MS'), '城市结果没有等待最小反馈时长')
  assert.ok(body.includes('this.citySearching = true'), '城市搜索没有同步进入查找中状态')
  assert.ok(body.indexOf('this.citySearching = true') < body.indexOf('setTimeout(runCitySearch'), '城市忙碌态必须在异步检索之前提交')
})

test('全局搜索同样先渲染查找中，再执行本地筛选和网络请求', () => {
  const source = read('src/common/page-logic.js')
  const body = methodBody(source, 'startSearch', 'applySearchResult')
  assert.ok(body.includes("this.searchTip = '查找中…'"), '全局搜索没有同步显示查找中')
  assert.ok(body.includes('setTimeout(runSearch, SEARCH_START_DELAY_MS)'), '全局搜索仍在点击事件中同步执行')
  assert.ok(body.includes('SEARCH_MIN_FEEDBACK_MS'), '全局缓存搜索没有保证查找中短暂可见')
  assert.ok(body.indexOf("this.searchTip = '查找中…'") < body.indexOf('setTimeout(runSearch'), '全局忙碌态必须在异步检索之前提交')
  assert.ok(body.indexOf('self.localMatches(keyword)') > body.indexOf('const runSearch'), '本地匹配仍阻塞点击事件')
})

test('搜索页状态提示在查找中使用高对比样式', () => {
  const city = read('src/pages/City/index.ux')
  const search = read('src/pages/Search/index.ux')
  const square = read('src/common/styles/watch-square.css')
  const round = read('src/common/styles/watch-round.css')
  assert.ok(city.includes("citySearching ? 'busy'"), '城市页查找中提示没有忙碌样式')
  assert.ok(search.includes("searching ? 'busy'"), '搜索页查找中提示没有忙碌样式')
  assert.ok(square.includes('.tip.busy') && round.includes('.tip.busy'), '方屏或圆屏缺少查找中高对比样式')
})

test('应用内彻底移除热门城市入口和回退', () => {
  const logic = read('src/common/page-logic.js')
  const helper = read('src/common/city-search.js')
  const chelaile = read('src/common/chelaile.js')
  const cityPage = read('src/pages/City/index.ux')
  assert.ok(!/hotCities|cityHot|_cityHotPromise|_cityAllFallback|loadCityList/.test(logic), '页面逻辑仍保留热门城市代码')
  assert.ok(!/hotCities|热门/.test(helper), '城市搜索助手仍保留热门城市逻辑')
  assert.ok(!/hot_only\s*:\s*1|fetchHotCities|hotCitiesMemory/.test(chelaile), '接口层仍在请求或缓存热门城市')
  assert.ok(!/热门|\bhot\b/.test(cityPage), '城市页仍展示热门城市标记')
})

test('城市缓存和完整列表请求会复用内存及并发任务', () => {
  const store = read('src/common/store.js')
  const chelaile = read('src/common/chelaile.js')
  assert.ok(store.includes('let citiesCache = null'), 'store 没有城市缓存内存复用')
  assert.ok(store.includes('let citiesLoading = null'), 'store 没有合并并发城市缓存读取')
  assert.ok(store.includes('citiesCache = entry'), 'store 没有在读取后保存城市缓存')
  assert.ok(chelaile.includes('let citiesRequest = null'), '接口层没有合并并发城市列表请求')
  assert.ok(chelaile.includes('citiesRequest = tracked'), '接口层没有保存城市列表并发任务')
})

test('搜索页在输入框下方显示查找中', () => {
  const page = read('src/pages/Search/index.ux')
  const logic = read('src/common/page-logic.js')
  assert.ok(page.includes("{{ searching ? '查找中…' : '搜索' }}"), '搜索按钮没有查找中状态')
  assert.ok(page.includes("mode === 'search' && searchTip"), '搜索页没有在输入框下方显示状态提示')
  assert.ok(logic.includes("this.searchTip = '查找中…'"), '搜索逻辑没有立即设置查找中')
  assert.ok(logic.includes('网络较慢，仍在查找…'), '慢网提示仍使用旧文案')
  assert.ok(logic.includes('查找超时，请检查网络后重试'), '超时提示仍使用旧文案')
})

test('首页不再后台预热搜索抢占弱网带宽', () => {
  const source = read('src/common/page-logic.js')
  const chelaile = read('src/common/chelaile.js')
  assert.ok(!/chelaile\.warmUp\(\)/.test(source), '首页仍在调用 warmUp')
  assert.ok(!/export function warmUp/.test(chelaile), '无用的 warmUp 仍被导出')
})

test('刷新入口使用高对比文案，城市按钮统一为搜索', () => {
  const home = read('src/pages/Home/index.ux')
  const city = read('src/pages/City/index.ux')
  const station = read('src/pages/Station/index.ux')
  const line = read('src/pages/Line/index.ux')
  assert.ok(home.includes('↻ 刷新'), '首页刷新入口文案不够醒目')
  assert.ok(home.includes('刷新中…'), '首页刷新中状态不明显')
  assert.ok(station.includes('刷新中…') && line.includes('刷新中…'), '站点/线路刷新中状态不明显')
  assert.ok(city.includes('查找中…'), '城市按钮没有查找中状态')
})

test('每个页面只打包自己的模板，减少启动解析和渲染开销', () => {
  ;['City', 'Search', 'Station', 'Line'].forEach((page) => {
    const file = `src/pages/${page}/index.ux`
    const size = fs.statSync(path.join(root, file)).size
    assert.ok(size < 6000, `${file} 仍有 ${size} 字节，模板尚未拆分`)
  })
})

test('首次城市搜索使用内置全国索引，不再等待城市列表网络请求', () => {
  const dataText = read('src/common/builtin-cities.js')
  const json = dataText.replace(/^[\s\S]*?export default\s+/, '').trim()
  const rows = JSON.parse(json)
  assert.ok(rows.length >= 400, `内置城市索引过少：${rows.length}`)
  assert.ok(Buffer.byteLength(dataText) < 20000, '内置城市索引过大，可能拖慢页面加载')
  assert.strictEqual(new Set(rows.map((row) => row[0])).size, rows.length, '内置城市 ID 存在重复')
  assert.ok(rows.every((row) => row[0] && row[1] && row[2]), '内置城市索引存在缺失字段')

  const source = read('src/common/page-logic.js')
  const cityPage = read('src/pages/City/index.ux')
  const body = methodBody(source, 'initCityView', 'onShow')
  assert.ok(!source.includes("import BUILTIN_CITIES from './builtin-cities'"), '城市数据不应被所有页面共享引用')
  assert.ok(cityPage.includes("import BUILTIN_CITIES from '../../common/builtin-cities'"), '城市页没有接入内置城市索引')
  assert.ok(cityPage.includes('setBuiltInCities(BUILTIN_CITIES)'), '城市页没有注入内置城市索引')
  assert.ok(body.includes('this.cityAll = builtinCityList.slice()'), '进入城市页没有立即装载内置城市索引')
  assert.ok(body.includes('this.cityCacheReady = builtinCityList.length > 0'), '内置城市索引没有标记为可用')
})

let failed = 0
for (const item of tests) {
  try {
    item.fn()
    console.log(`PASS ${item.name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${item.name}`)
    console.error(`  ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${tests.length} 项失败`)
  process.exit(1)
}
console.log(`\n${tests.length}/${tests.length} 项通过`)
