import { formatCountdown, getAccountSnapshot, toDate } from './account-utils'

const TREND_WINDOW_DAYS = 7
const MAX_USAGE_HISTORY = 30

function getLocalDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getLocalDayLabel(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
  }).format(date)
}

export function getUsageMetrics(account) {
  const usageHistory = Array.isArray(account.usageHistory)
    ? account.usageHistory.map(toDate).filter(Boolean).sort((left, right) => left - right)
    : []
  const lastUsedAt = toDate(account.lastUsedAt)

  if (!usageHistory.length && lastUsedAt) {
    usageHistory.push(lastUsedAt)
  }

  const persistedCount = Number(account.usageCount)
  const usageCount = Number.isFinite(persistedCount)
    ? Math.max(persistedCount, usageHistory.length)
    : usageHistory.length

  return {
    usageCount,
    usageHistory,
  }
}

export function buildUsageUpdate(account, when = new Date()) {
  const metrics = getUsageMetrics(account)
  const nextHistory = [...metrics.usageHistory, when]
    .sort((left, right) => left - right)
    .slice(-MAX_USAGE_HISTORY)
    .map((entry) => entry.toISOString())

  return {
    usageCount: Math.max(metrics.usageCount + 1, nextHistory.length),
    usageHistory: nextHistory,
  }
}

function withSnapshot(account, now) {
  return {
    ...account,
    snapshot: account.snapshot ?? getAccountSnapshot(account, now),
    usage: getUsageMetrics(account),
  }
}

export function buildAnalytics(accounts, now = new Date()) {
  const enrichedAccounts = accounts.map((account) => withSnapshot(account, now))
  const statusCounts = enrichedAccounts.reduce(
    (counts, account) => {
      counts[account.snapshot.status] += 1
      return counts
    },
    { green: 0, yellow: 0, red: 0 },
  )
  const readyAccounts = enrichedAccounts.filter((account) => account.snapshot.status === 'green')
  const mostUsed = [...enrichedAccounts]
    .sort((left, right) => {
      if (left.usage.usageCount !== right.usage.usageCount) {
        return right.usage.usageCount - left.usage.usageCount
      }

      return (
        (right.snapshot.lastUsedAt?.getTime() ?? 0) -
        (left.snapshot.lastUsedAt?.getTime() ?? 0)
      )
    })
    .slice(0, 5)
  const leastUsed = [...enrichedAccounts]
    .sort((left, right) => {
      if (left.usage.usageCount !== right.usage.usageCount) {
        return left.usage.usageCount - right.usage.usageCount
      }

      return (
        (left.snapshot.lastUsedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.snapshot.lastUsedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
      )
    })
    .slice(0, 5)
  const longestReset = enrichedAccounts
    .filter((account) => (account.snapshot.millisecondsUntilReset ?? 0) > 0)
    .sort(
      (left, right) =>
        (right.snapshot.millisecondsUntilReset ?? 0) -
        (left.snapshot.millisecondsUntilReset ?? 0),
    )
    .slice(0, 5)
    .map((account) => ({
      ...account,
      waitText: formatCountdown(account.snapshot.millisecondsUntilReset),
    }))

  const usageByDay = Array.from({ length: TREND_WINDOW_DAYS }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index)
    const key = getLocalDayKey(date)

    return {
      key,
      label: getLocalDayLabel(date),
      fullLabel: new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      }).format(date),
      count: 0,
    }
  }).reverse()

  const usageLookup = new Map(usageByDay.map((item) => [item.key, item]))
  let totalUsageEvents = 0

  for (const account of enrichedAccounts) {
    for (const entry of account.usage.usageHistory) {
      totalUsageEvents += 1
      const key = getLocalDayKey(entry)
      const bucket = usageLookup.get(key)

      if (bucket) {
        bucket.count += 1
      }
    }
  }

  const maxTrendCount = Math.max(...usageByDay.map((item) => item.count), 0)

  return {
    statusCounts,
    readyAccounts: readyAccounts.slice(0, 6),
    mostUsed,
    leastUsed,
    longestReset,
    usageByDay,
    totalUsageEvents,
    maxTrendCount,
    readyCount: readyAccounts.length,
    blockedCount: statusCounts.red,
  }
}
