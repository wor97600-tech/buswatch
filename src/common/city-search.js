export function filterCities(cities, query) {
  const list = Array.isArray(cities) ? cities : []
  const text = String(query === undefined || query === null ? '' : query)
    .trim()
    .toLowerCase()
  if (!text) {
    return []
  }
  return list.filter(
    (city) =>
      String(city && city.cityName ? city.cityName : '')
        .toLowerCase()
        .indexOf(text) >= 0 ||
      String(city && city.pinyin ? city.pinyin : '')
        .toLowerCase()
        .indexOf(text) >= 0
  )
}

export function beginCitySearch(query, cities, complete) {
  const matches = filterCities(cities, query)
  const hasMatches = matches.length > 0
  return {
    searching: true,
    matches: matches,
    needsNetwork: !complete && !hasMatches,
    hint: '查找中…'
  }
}
