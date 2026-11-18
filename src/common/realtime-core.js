function normalizeLine(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/[（(].*$/, '')
    .trim()
}

export function normalizeStop(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/[（(].*$/, '')
    .trim()
}

function terminalMatches(a, b) {
  const left = normalizeStop(a)
  const right = normalizeStop(b)
  if (!left || !right) {
    return false
  }
  return left === right || left.indexOf(right) >= 0 || right.indexOf(left) >= 0
}

export function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value === 'number') {
    return isFinite(value) ? value : null
  }
  const matched = String(value).match(/-?[0-9]+(?:\.[0-9]+)?/)
  if (!matched) {
    return null
  }
  const num = Number(matched[0])
  return isFinite(num) ? num : null
}

export function toNumber(value) {
  const num = toNumberOrNull(value)
  return num === null ? 0 : num
}

function busEtaSeconds(bus, now) {
  if (!bus) {
    return null
  }
  const travel = toNumberOrNull(
    bus.travelTime !== undefined ? bus.travelTime : bus.travel_time
  )
  if (travel !== null && travel >= 0) {
    return Math.round(travel)
  }
  const minutes = toNumberOrNull(
    bus.travel_minutes !== undefined ? bus.travel_minutes : bus.travelMinutes
  )
  if (minutes !== null && minutes >= 0) {
    return Math.round(minutes * 60)
  }
  const arrival = toNumberOrNull(
    bus.arrivalTime !== undefined ? bus.arrivalTime : bus.arrival_time
  )
  if (arrival !== null && arrival > 0) {
    const diff = Math.round((arrival - (now || Date.now())) / 1000)
    if (diff >= 0) {
      return diff
    }
  }
  return null
}

function busDistance(bus) {
  const value = toNumberOrNull(
    bus && (bus.distanceToDest !== undefined ? bus.distanceToDest : bus.distance)
  )
  if (value === null || value < 0) {
    return null
  }
  return value
}

function targetOrderOf(line, saved) {
  const fromLine = toNumberOrNull(line && line.targetOrder)
  if (fromLine !== null && fromLine > 0) {
    return fromLine
  }
  const fromSaved = toNumberOrNull(saved && saved.targetOrder)
  if (fromSaved !== null && fromSaved > 0) {
    return fromSaved
  }
  return null
}

export function selectBus(line, saved) {
  const buses = Array.isArray(line && line.buses) ? line.buses : []
  const targetOrder = targetOrderOf(line, saved)
  const now = Date.now()
  const usable = []

  buses.forEach((bus) => {
    if (!bus) {
      return
    }
    const order = toNumberOrNull(bus.order)
    if (order !== null && order > 0 && targetOrder !== null && order > targetOrder) {
      return
    }
    const seconds = busEtaSeconds(bus, now)
    const distance = busDistance(bus)
    if (seconds === null && (distance === null || distance <= 0)) {
      return
    }
    usable.push({ bus: bus, seconds: seconds, order: order, distance: distance })
  })

  const withEta = usable.filter((item) => item.seconds !== null)
  if (withEta.length > 0) {
    withEta.sort((left, right) => left.seconds - right.seconds)
    return withEta[0]
  }

  const inTransit = usable.filter((item) => item.distance !== null && item.distance > 0)
  if (inTransit.length > 0) {
    inTransit.sort((left, right) => left.distance - right.distance)
    return inTransit[0]
  }

  return null
}

export function arrivalText(pick) {
  if (!pick) {
    return { text: '暂无在途车辆', live: false }
  }
  if (pick.seconds === null) {
    return { text: '在途', live: true }
  }
  if (pick.seconds <= 45) {
    return { text: '即将到站', live: true }
  }
  const minutes = Math.max(1, Math.round(pick.seconds / 60))
  return { text: `约 ${minutes} 分钟`, live: true }
}

export function busSummary(pick) {
  if (!pick) {
    return ''
  }
  const parts = []
  if (pick.bus && (pick.bus.busId || pick.bus.bus_id)) {
    parts.push(pick.bus.busId || pick.bus.bus_id)
  }
  if (pick.distance !== null && pick.distance > 0) {
    parts.push(`距本站 ${Math.round(pick.distance)} 米`)
  }
  if (pick.seconds === null && parts.length === 0) {
    parts.push('时间待更新')
  }
  return parts.join(' · ')
}

export function findLine(lines, saved) {
  if (!Array.isArray(lines) || lines.length === 0 || !saved) {
    return null
  }
  const list = lines.filter(Boolean)
  const lineId = saved.lineId !== undefined && saved.lineId !== null ? String(saved.lineId) : ''
  if (lineId) {
    const byId = list.filter((line) => String(line.id) === lineId)[0]
    if (byId) {
      return byId
    }
  }
  const name = normalizeLine(saved.shortName || saved.lineName)
  if (!name) {
    return null
  }
  const sameName = list.filter((line) => normalizeLine(line.name) === name)
  if (sameName.length === 0) {
    return null
  }
  const direction = toNumberOrNull(saved.direction)
  if (direction !== null) {
    const byDirection = sameName.filter(
      (line) => toNumberOrNull(line.direction) === direction
    )[0]
    if (byDirection) {
      return byDirection
    }
  }
  const byEnd = sameName.filter((line) => terminalMatches(line.endStop, saved.endStop))[0]
  return byEnd || sameName[0]
}

export default {
  normalizeStop,
  toNumberOrNull,
  toNumber,
  selectBus,
  arrivalText,
  busSummary,
  findLine
}
