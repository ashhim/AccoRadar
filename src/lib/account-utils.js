const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const SOON_WINDOW_MS = 3 * HOUR_MS

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const LIMIT_PATTERNS = [
  /out of codex messages/i,
  /rate limit/i,
  /limit reached/i,
  /try again later/i,
  /upgrade to plus/i,
  /quota/i,
]

const HEALTHY_PATTERNS = [
  /\b\d+\s+messages?\s+left\b/i,
  /\bavailable\b/i,
  /\bhealthy\b/i,
  /\bready\b/i,
]

const RESET_CONTEXT_PATTERNS = [
  /(?:reset(?:s)?|renews?|refreshes?|available again|try again(?: after)?)([^.!?\n]*)/gi,
  /(?:rate limit|quota|messages?)([^.!?\n]{0,120})/gi,
]

const DATE_TIME_PATTERNS = [
  /([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*(?:UTC|GMT|IST|[A-Z]{2,5}))?)/gi,
  /(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi,
  /(\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)/gi,
]

export const STATUS_CONFIG = {
  green: {
    label: 'Green',
    shortLabel: 'Ready',
    description: 'Safe to use now.',
  },
  yellow: {
    label: 'Yellow',
    shortLabel: 'Soon',
    description: 'Nearly available again.',
  },
  red: {
    label: 'Red',
    shortLabel: 'Blocked',
    description: 'Still rate-limited or missing a usable reset time.',
  },
}

export function normalizeWhitespace(value = '') {
  return value.replace(/\s+/g, ' ').trim()
}

export function toDate(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value?.toDate === 'function') {
    const date = value.toDate()
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function buildLocalDate(year, monthIndex, day, hour, minute, second = 0) {
  const date = new Date(year, monthIndex, day, hour, minute, second, 0)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null
  }

  return date
}

function parseNamedMonthCandidate(candidate) {
  const match = candidate.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:,)?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?(?:\s*(UTC|GMT|IST|[A-Z]{2,5}))?$/i,
  )

  if (!match) {
    return null
  }

  const [, monthName, dayText, yearText, hourText, minuteText, ampm, timezone] = match
  const monthIndex = MONTHS[monthName.toLowerCase()]

  if (monthIndex === undefined) {
    return null
  }

  const day = Number(dayText)
  const year = Number(yearText)
  let hour = Number(hourText)
  const minute = Number(minuteText)

  if (ampm) {
    const upper = ampm.toUpperCase()

    if (upper === 'PM' && hour !== 12) {
      hour += 12
    }

    if (upper === 'AM' && hour === 12) {
      hour = 0
    }
  }

  if (timezone) {
    const parsed = Date.parse(candidate)
    return Number.isNaN(parsed) ? null : new Date(parsed)
  }

  return buildLocalDate(year, monthIndex, day, hour, minute)
}

function parseSlashCandidate(candidate) {
  const match = candidate.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,)?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i,
  )

  if (!match) {
    return null
  }

  const [, monthText, dayText, yearText, hourText, minuteText, ampm] = match
  const monthIndex = Number(monthText) - 1
  const day = Number(dayText)
  const year = yearText.length === 2 ? Number(`20${yearText}`) : Number(yearText)
  let hour = Number(hourText)
  const minute = Number(minuteText)

  if (ampm) {
    const upper = ampm.toUpperCase()

    if (upper === 'PM' && hour !== 12) {
      hour += 12
    }

    if (upper === 'AM' && hour === 12) {
      hour = 0
    }
  }

  return buildLocalDate(year, monthIndex, day, hour, minute)
}

function parseIsoCandidate(candidate) {
  const parsed = Date.parse(candidate)
  return Number.isNaN(parsed) ? null : new Date(parsed)
}

function parseDateCandidate(candidate) {
  const cleaned = candidate.replace(/[.)]+$/, '').trim()

  return (
    parseNamedMonthCandidate(cleaned) ??
    parseSlashCandidate(cleaned) ??
    parseIsoCandidate(cleaned)
  )
}

function collectDateCandidates(source) {
  const matches = []

  for (const pattern of DATE_TIME_PATTERNS) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)

    while (match) {
      matches.push(match[1])
      match = pattern.exec(source)
    }
  }

  return matches
}

function detectIntent(message) {
  if (HEALTHY_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'healthy'
  }

  if (LIMIT_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'limited'
  }

  return 'unknown'
}

export function parseLimitMessage(message) {
  const text = normalizeWhitespace(message)

  if (!text) {
    return {
      resetAt: null,
      matchedText: '',
      parserState: 'empty',
      detectedIntent: 'healthy',
      explanation: 'No limit message stored yet.',
    }
  }

  const sources = []

  for (const pattern of RESET_CONTEXT_PATTERNS) {
    pattern.lastIndex = 0
    let match = pattern.exec(text)

    while (match) {
      sources.push(match[0])
      if (match[1]) {
        sources.push(match[1])
      }
      match = pattern.exec(text)
    }
  }

  sources.push(text)

  const candidates = [...new Set(sources.flatMap(collectDateCandidates))]

  for (const candidate of candidates) {
    const resetAt = parseDateCandidate(candidate)

    if (resetAt) {
      return {
        resetAt,
        matchedText: candidate,
        parserState: 'parsed',
        detectedIntent: detectIntent(text),
        explanation: `Detected reset time from "${candidate}".`,
      }
    }
  }

  const detectedIntent = detectIntent(text)

  if (detectedIntent === 'healthy') {
    return {
      resetAt: null,
      matchedText: '',
      parserState: 'healthy',
      detectedIntent,
      explanation: 'Message looks healthy and does not include a reset time.',
    }
  }

  return {
    resetAt: null,
    matchedText: '',
    parserState: 'unparsed',
    detectedIntent,
    explanation: 'No reset date/time could be detected from the pasted message.',
  }
}

function getStatusRank(status) {
  switch (status) {
    case 'green':
      return 0
    case 'yellow':
      return 1
    default:
      return 2
  }
}

export function formatCountdown(milliseconds) {
  if (milliseconds <= 0) {
    return 'Ready now'
  }

  const days = Math.floor(milliseconds / DAY_MS)
  const hours = Math.floor((milliseconds % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((milliseconds % HOUR_MS) / MINUTE_MS)
  const seconds = Math.floor((milliseconds % MINUTE_MS) / SECOND_MS)

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function formatElapsed(milliseconds) {
  const absolute = Math.abs(milliseconds)
  const days = Math.floor(absolute / DAY_MS)
  const hours = Math.floor((absolute % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((absolute % HOUR_MS) / MINUTE_MS)

  if (days > 0) {
    return `${days}d ${hours}h ago`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ago`
  }

  if (minutes > 0) {
    return `${minutes}m ago`
  }

  return 'just now'
}

export function formatDateTime(value) {
  const date = toDate(value)

  if (!date) {
    return 'Not set'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatBoardDateTime(value, now = new Date()) {
  const date = toDate(value)

  if (!date) {
    return 'Not set'
  }

  const sameYear = date.getFullYear() === now.getFullYear()

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatLastUsed(value, now = new Date()) {
  const date = toDate(value)

  if (!date) {
    return 'Never'
  }

  return `${formatDateTime(date)} (${formatElapsed(now.getTime() - date.getTime())})`
}

export function formatBoardLastUsed(value, now = new Date()) {
  const date = toDate(value)

  if (!date) {
    return 'Never'
  }

  return `${formatBoardDateTime(date, now)} · ${formatElapsed(
    now.getTime() - date.getTime(),
  )}`
}

export function toDateTimeLocalValue(value) {
  const date = toDate(value)

  if (!date) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function parseDateTimeLocalValue(value) {
  if (!value) {
    return null
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)

  if (!match) {
    return null
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match

  return buildLocalDate(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
  )
}

export function getAccountSnapshot(account, now = new Date()) {
  const limitMessage = account.limitMessage?.trim() ?? ''
  const resetAt = toDate(account.resetAt)
  const lastUsedAt = toDate(account.lastUsedAt)
  const orderIndex = Number.isFinite(Number(account.orderIndex))
    ? Number(account.orderIndex)
    : 999
  const hasMessage = Boolean(limitMessage)
  const detectedIntent = account.detectedIntent ?? detectIntent(limitMessage)
  const millisecondsUntilReset = resetAt ? resetAt.getTime() - now.getTime() : null

  let status
  let reason
  let countdownText

  if (!hasMessage) {
    status = 'green'
    reason = 'No limit message stored.'
    countdownText = 'Available now'
  } else if (detectedIntent === 'healthy' && !resetAt) {
    status = 'green'
    reason = 'Healthy message stored.'
    countdownText = 'Healthy now'
  } else if (!resetAt) {
    status = detectedIntent === 'limited' ? 'red' : 'yellow'
    reason = 'Needs a recognizable reset time.'
    countdownText = 'Needs review'
  } else if (millisecondsUntilReset <= 0) {
    status = 'green'
    reason = 'Reset time has passed.'
    countdownText = 'Ready now'
  } else if (millisecondsUntilReset <= SOON_WINDOW_MS) {
    status = 'yellow'
    reason = 'Reset window is close.'
    countdownText = formatCountdown(millisecondsUntilReset)
  } else {
    status = 'red'
    reason = 'Still rate-limited.'
    countdownText = formatCountdown(millisecondsUntilReset)
  }

  let score

  if (status === 'green') {
    const idleHours = lastUsedAt
      ? clamp((now.getTime() - lastUsedAt.getTime()) / HOUR_MS, 0, 120)
      : 120
    const resetBonus =
      resetAt && millisecondsUntilReset !== null && millisecondsUntilReset <= 0 ? 30 : 60

    score = Math.round(300 + idleHours + resetBonus - orderIndex)
  } else if (status === 'yellow') {
    const remainingHours = millisecondsUntilReset === null ? 12 : millisecondsUntilReset / HOUR_MS
    score = Math.round(220 - clamp(remainingHours * 10, 0, 120))
  } else {
    const remainingHours = millisecondsUntilReset === null ? 48 : millisecondsUntilReset / HOUR_MS
    score = Math.round(120 - clamp(remainingHours * 4, 0, 110))
  }

  return {
    status,
    statusRank: getStatusRank(status),
    reason,
    countdownText,
    score,
    resetAt,
    lastUsedAt,
    millisecondsUntilReset,
    statusMeta: STATUS_CONFIG[status],
  }
}

export function sortAccounts(accounts, now = new Date()) {
  return [...accounts]
    .map((account) => ({
      ...account,
      snapshot: getAccountSnapshot(account, now),
    }))
    .sort((left, right) => {
      if (left.snapshot.statusRank !== right.snapshot.statusRank) {
        return left.snapshot.statusRank - right.snapshot.statusRank
      }

      if (left.snapshot.status === 'green') {
        const leftLastUsed = left.snapshot.lastUsedAt?.getTime() ?? 0
        const rightLastUsed = right.snapshot.lastUsedAt?.getTime() ?? 0

        if (leftLastUsed !== rightLastUsed) {
          return leftLastUsed - rightLastUsed
        }
      } else {
        const leftReset = left.snapshot.resetAt?.getTime() ?? Number.MAX_SAFE_INTEGER
        const rightReset = right.snapshot.resetAt?.getTime() ?? Number.MAX_SAFE_INTEGER

        if (leftReset !== rightReset) {
          return leftReset - rightReset
        }
      }

      if (left.snapshot.score !== right.snapshot.score) {
        return right.snapshot.score - left.snapshot.score
      }

      const leftOrder = Number.isFinite(Number(left.orderIndex)) ? Number(left.orderIndex) : 999
      const rightOrder = Number.isFinite(Number(right.orderIndex)) ? Number(right.orderIndex) : 999

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return (left.name ?? '').localeCompare(right.name ?? '')
    })
}

export function buildAccountRecord(draft, now = new Date()) {
  const limitMessage = draft.limitMessage ?? ''
  const parsedMessage = parseLimitMessage(limitMessage)
  const resetAt =
    parseDateTimeLocalValue(draft.resetAtInput) ??
    parsedMessage.resetAt ??
    null
  const lastUsedAt = parseDateTimeLocalValue(draft.lastUsedAtInput)
  const orderIndex = Number.isFinite(Number(draft.orderIndex))
    ? Number(draft.orderIndex)
    : 999

  const record = {
    name: draft.name.trim(),
    email: draft.email.trim(),
    limitMessage,
    resetAt,
    lastUsedAt,
    notes: draft.notes.trim(),
    orderIndex,
    parserState: parsedMessage.parserState,
    detectedIntent: parsedMessage.detectedIntent,
    parsedResetSource: parsedMessage.matchedText || null,
  }

  const snapshot = getAccountSnapshot(record, now)

  return {
    ...record,
    status: snapshot.status,
    countdownText: snapshot.countdownText,
    score: snapshot.score,
  }
}
