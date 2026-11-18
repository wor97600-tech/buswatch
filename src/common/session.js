// 页面间共享的上下文（router params 只能传字符串）
let pendingStation = null
let pendingLine = null
let cityChanged = false

export function setStation(value) { pendingStation = value || null }
export function takeStation() { const v = pendingStation; pendingStation = null; return v }
export function peekStation() { return pendingStation }

export function setLine(value) { pendingLine = value || null }
export function takeLine() { const v = pendingLine; pendingLine = null; return v }
export function peekLine() { return pendingLine }

export function markCityChanged() { cityChanged = true }
export function consumeCityChanged() { const v = cityChanged; cityChanged = false; return v }

export default {
  setStation, takeStation, peekStation,
  setLine, takeLine, peekLine,
  markCityChanged, consumeCityChanged
}