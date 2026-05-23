import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import './App.css'
import { auth, db, ADMIN_EMAIL } from './lib/firebase'
import {
  buildAccountRecord,
  formatBoardDateTime,
  formatBoardLastUsed,
  formatDateTime,
  formatLastUsed,
  getAccountSnapshot,
  parseLimitMessage,
  sortAccounts,
  STATUS_CONFIG,
  toDate,
  toDateTimeLocalValue,
} from './lib/account-utils'
import { buildAnalytics, buildUsageUpdate } from './lib/dashboard-analytics'

const ACCOUNTS_COLLECTION = 'accounts'
const PUBLIC_HASH = '#/public'
const ADMIN_HASH = '#/admin'
const THEME_STORAGE_KEY = 'accoradar-theme'

function getViewFromHash(hash) {
  return hash.toLowerCase().includes('admin') ? 'admin' : 'public'
}

function getInitialTheme() {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return storedTheme === 'light' ? 'light' : 'dark'
}

function normalizeAccountDocument(snapshot) {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    ...data,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    resetAt: toDate(data.resetAt),
    lastUsedAt: toDate(data.lastUsedAt),
    usageCount: Number.isFinite(Number(data.usageCount)) ? Number(data.usageCount) : 0,
    usageHistory: Array.isArray(data.usageHistory)
      ? data.usageHistory.map(toDate).filter(Boolean)
      : [],
  }
}

function buildEmptyDraft(orderIndex = 1) {
  return {
    name: '',
    email: '',
    limitMessage: '',
    notes: '',
    orderIndex: String(orderIndex),
    resetAtInput: '',
    lastUsedAtInput: '',
  }
}

function buildDraftFromAccount(account) {
  return {
    name: account.name ?? '',
    email: account.email ?? '',
    limitMessage: account.limitMessage ?? '',
    notes: account.notes ?? '',
    orderIndex:
      account.orderIndex === null || account.orderIndex === undefined
        ? ''
        : String(account.orderIndex),
    resetAtInput: toDateTimeLocalValue(account.resetAt),
    lastUsedAtInput: toDateTimeLocalValue(account.lastUsedAt),
  }
}

function mergeLimitMessageIntoDraft(
  draft,
  value,
  { clearResetOnMissingParse = false } = {},
) {
  const parsed = parseLimitMessage(value)

  return {
    ...draft,
    limitMessage: value,
    resetAtInput: parsed.resetAt
      ? toDateTimeLocalValue(parsed.resetAt)
      : value.trim()
        ? clearResetOnMissingParse
          ? ''
          : draft.resetAtInput
        : '',
  }
}

function getStatusClass(status) {
  return `status-badge status-${status}`
}

function describeFirebaseError(error) {
  switch (error?.code) {
    case 'auth/invalid-credential':
      return 'Incorrect password or missing email/password provider in Firebase Authentication.'
    case 'auth/too-many-requests':
      return 'Too many failed login attempts. Wait a bit and try again.'
    case 'auth/network-request-failed':
      return 'Network error while talking to Firebase.'
    case 'permission-denied':
      return 'Firestore permissions denied. Check the deployed security rules.'
    default:
      return error?.message ?? 'Something went wrong while talking to Firebase.'
  }
}

function summarizeAccounts(accounts) {
  return accounts.reduce(
    (summary, account) => {
      summary.total += 1
      summary[account.snapshot.status] += 1
      return summary
    },
    { total: 0, green: 0, yellow: 0, red: 0 },
  )
}

async function readClipboardText() {
  if (!navigator.clipboard?.readText) {
    throw new Error('Clipboard access is not available in this browser.')
  }

  const text = await navigator.clipboard.readText()

  if (!text.trim()) {
    throw new Error('Clipboard is empty.')
  }

  return text
}

function ThemeIcon({ theme }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 4.5V2m0 20v-2.5m7.5-7.5H22M2 12h2.5m14.56 5.06 1.77 1.77M3.67 3.67l1.77 1.77m12.85-1.77-1.77 1.77M5.44 17.06l-1.77 1.77M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.8 14.2A8.8 8.8 0 1 1 9.8 3.2a7 7 0 0 0 11 11Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function StatusBadge({ status }) {
  const meta = STATUS_CONFIG[status]

  return <span className={getStatusClass(status)}>{meta.shortLabel}</span>
}

function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      type="button"
      className="icon-button"
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      <ThemeIcon theme={theme} />
    </button>
  )
}

function AppHeader({
  view,
  onViewChange,
  theme,
  onToggleTheme,
  isAdmin,
  onSignOut,
  onOpenCreate,
}) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-lockup">
          <span className="brand-mark">AR</span>
          <div>
            <p className="eyebrow">AccoRadar</p>
            <h1>Codex account dashboard</h1>
          </div>
        </div>
        <p className="lede">
          Monitor account availability, reset windows, and usage activity from a
          single board.
        </p>
      </div>

      <div className="topbar-controls">
        <nav className="view-switch" aria-label="Dashboard views">
          <button
            type="button"
            className={view === 'public' ? 'is-active' : ''}
            onClick={() => onViewChange('public')}
          >
            Public
          </button>
          <button
            type="button"
            className={view === 'admin' ? 'is-active' : ''}
            onClick={() => onViewChange('admin')}
          >
            Admin
          </button>
        </nav>

        <ThemeToggle theme={theme} onToggle={onToggleTheme} />

        {view === 'admin' && isAdmin ? (
          <button type="button" className="primary-button compact" onClick={onOpenCreate}>
            <PlusIcon />
            <span>Account</span>
          </button>
        ) : null}

        {isAdmin ? (
          <button type="button" className="ghost-button compact" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  )
}

function NoticeBanner({ notice, onDismiss }) {
  if (!notice) {
    return null
  }

  return (
    <div className={`notice-banner notice-${notice.tone}`}>
      <p>{notice.message}</p>
      <button type="button" className="ghost-button compact" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function SummarySection({ bestAccount, summary, now }) {
  const summaryCards = [
    { label: 'Ready now', value: summary.green },
    { label: 'Reset soon', value: summary.yellow },
    { label: 'Blocked', value: summary.red },
    { label: 'Tracked', value: summary.total },
  ]

  return (
    <section className="summary-layout">
      <article className="panel summary-hero">
        <div className="section-label-row">
          <div>
            <p className="eyebrow">Summary</p>
            <h2>Best next account</h2>
          </div>
          {bestAccount ? <StatusBadge status={bestAccount.snapshot.status} /> : null}
        </div>

        {bestAccount ? (
          <>
            <div className="hero-account">
              <div>
                <h3>{bestAccount.name}</h3>
                <p className="hero-meta">{bestAccount.email}</p>
              </div>
              <div className="score-chip">Score {bestAccount.snapshot.score}</div>
            </div>

            <p className="muted-copy">{bestAccount.snapshot.reason}</p>

            <div className="hero-metrics">
              <div>
                <span>Countdown</span>
                <strong>{bestAccount.snapshot.countdownText}</strong>
              </div>
              <div>
                <span>Reset time</span>
                <strong>{formatBoardDateTime(bestAccount.snapshot.resetAt, now)}</strong>
              </div>
              <div>
                <span>Last used</span>
                <strong>{formatBoardLastUsed(bestAccount.snapshot.lastUsedAt, now)}</strong>
              </div>
            </div>
          </>
        ) : (
          <p className="muted-copy">
            No accounts have been created yet. Use the admin panel to start
            tracking them.
          </p>
        )}
      </article>

      <div className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="panel stat-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>
    </section>
  )
}

function AnalyticsCard({ title, subtitle, children }) {
  return (
    <article className="panel analytics-card">
      <div className="section-label-row analytics-heading">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p className="muted-copy">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </article>
  )
}

function UsageRankList({ items, emptyText, type }) {
  const maxValue = Math.max(...items.map((item) => item.usage.usageCount), 0)

  if (!items.length) {
    return <p className="muted-copy">{emptyText}</p>
  }

  return (
    <div className="analytics-list">
      {items.map((item) => {
        const barWidth =
          maxValue > 0 ? `${Math.max((item.usage.usageCount / maxValue) * 100, 12)}%` : '12%'

        return (
          <div key={`${type}-${item.id}`} className="analytics-item">
            <div className="analytics-item-topline">
              <strong>{item.name}</strong>
              <span>{item.usage.usageCount}</span>
            </div>
            <div className="mini-bar-track">
              <span className="mini-bar-fill" style={{ width: barWidth }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusDistributionCard({ analytics }) {
  const total =
    analytics.statusCounts.green + analytics.statusCounts.yellow + analytics.statusCounts.red || 1
  const segments = [
    {
      key: 'green',
      label: 'Ready',
      count: analytics.statusCounts.green,
    },
    {
      key: 'yellow',
      label: 'Soon',
      count: analytics.statusCounts.yellow,
    },
    {
      key: 'red',
      label: 'Blocked',
      count: analytics.statusCounts.red,
    },
  ]

  return (
    <AnalyticsCard
      title="Availability"
      subtitle="Current account status distribution"
    >
      <div className="distribution-bar" role="img" aria-label="Availability distribution">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`distribution-segment segment-${segment.key}`}
            style={{ width: `${(segment.count / total) * 100}%` }}
          />
        ))}
      </div>

      <div className="distribution-legend">
        {segments.map((segment) => (
          <div key={segment.key} className="legend-item">
            <span className={`legend-dot dot-${segment.key}`} />
            <div>
              <strong>{segment.count}</strong>
              <small>{segment.label}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="ready-list">
        <span className="analytics-subtitle">Ready now</span>
        {analytics.readyAccounts.length ? (
          <div className="chip-list">
            {analytics.readyAccounts.map((account) => (
              <span key={account.id} className="data-chip">
                {account.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No accounts are immediately available.</p>
        )}
      </div>
    </AnalyticsCard>
  )
}

function UsageComparisonCard({ analytics }) {
  return (
    <AnalyticsCard
      title="Usage ranking"
      subtitle="Most active versus least used accounts"
    >
      <div className="split-analytics">
        <div>
          <span className="analytics-subtitle">Most used</span>
          <UsageRankList
            items={analytics.mostUsed}
            emptyText="Use actions will populate this list."
            type="most-used"
          />
        </div>
        <div>
          <span className="analytics-subtitle">Least used</span>
          <UsageRankList
            items={analytics.leastUsed}
            emptyText="Use actions will populate this list."
            type="least-used"
          />
        </div>
      </div>
    </AnalyticsCard>
  )
}

function ResetQueueCard({ analytics }) {
  const maxWait = Math.max(
    ...analytics.longestReset.map((item) => item.snapshot.millisecondsUntilReset ?? 0),
    0,
  )

  return (
    <AnalyticsCard
      title="Reset queue"
      subtitle="Accounts waiting the longest before they return"
    >
      {analytics.longestReset.length ? (
        <div className="analytics-list">
          {analytics.longestReset.map((item) => {
            const ratio =
              maxWait > 0
                ? `${Math.max(
                    ((item.snapshot.millisecondsUntilReset ?? 0) / maxWait) * 100,
                    12,
                  )}%`
                : '12%'

            return (
              <div key={item.id} className="analytics-item">
                <div className="analytics-item-topline">
                  <strong>{item.name}</strong>
                  <span>{item.waitText}</span>
                </div>
                <div className="mini-bar-track">
                  <span className="mini-bar-fill muted" style={{ width: ratio }} />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="muted-copy">No blocked accounts are currently waiting on a reset.</p>
      )}
    </AnalyticsCard>
  )
}

function UsageTrendCard({ analytics }) {
  const hasData = analytics.totalUsageEvents > 0
  const maxCount = Math.max(analytics.maxTrendCount, 1)

  return (
    <AnalyticsCard
      title="Usage trend"
      subtitle="Use activity across the last seven days"
    >
      {hasData ? (
        <>
          <div className="trend-chart">
            {analytics.usageByDay.map((point) => (
              <div key={point.key} className="trend-column">
                <span
                  className="trend-bar"
                  style={{
                    height: `${Math.max((point.count / maxCount) * 100, point.count ? 10 : 4)}%`,
                  }}
                />
                <strong>{point.count}</strong>
                <small>{point.label}</small>
              </div>
            ))}
          </div>
          <p className="muted-copy">
            {analytics.totalUsageEvents} recorded use events in the current local history
            window.
          </p>
        </>
      ) : (
        <p className="muted-copy">
          Usage history appears after you start using the one-click <strong>Use</strong>{' '}
          action in the admin board.
        </p>
      )}
    </AnalyticsCard>
  )
}

function AnalyticsSection({ analytics }) {
  return (
    <section className="analytics-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Analytics</p>
          <h2>Operational insights</h2>
        </div>
        <p className="muted-copy">
          A compact view of usage behavior, account availability, and reset backlog.
        </p>
      </div>

      <div className="analytics-grid">
        <StatusDistributionCard analytics={analytics} />
        <UsageComparisonCard analytics={analytics} />
        <ResetQueueCard analytics={analytics} />
        <UsageTrendCard analytics={analytics} />
      </div>
    </section>
  )
}

function AccountBoardRow({
  account,
  rank,
  now,
  adminMode = false,
  rowBusy,
  onEdit,
  onLoadLimit,
  onUseNow,
}) {
  const snapshot = account.snapshot ?? getAccountSnapshot(account, now)
  const rowBusyMatch = rowBusy?.accountId === account.id

  return (
    <article className={`board-row ${adminMode ? 'with-actions' : ''}`}>
      <div className="board-cell cell-rank" data-label="Rank">
        <span className="rank-pill">#{rank}</span>
      </div>

      <div className="board-cell cell-account" data-label="Account">
        <div className="account-primary">
          <strong>{account.name}</strong>
          <span>{account.email}</span>
        </div>
        <div className="account-secondary">
          <span>Score {snapshot.score}</span>
          <span>{snapshot.reason}</span>
        </div>
      </div>

      <div className="board-cell" data-label="Status">
        <StatusBadge status={snapshot.status} />
      </div>

      <div className="board-cell" data-label="Countdown">
        <strong>{snapshot.countdownText}</strong>
      </div>

      <div className="board-cell" data-label="Reset time">
        <span>{formatBoardDateTime(snapshot.resetAt, now)}</span>
      </div>

      <div className="board-cell" data-label="Last used">
        <span>{formatBoardLastUsed(snapshot.lastUsedAt, now)}</span>
      </div>

      {adminMode ? (
        <div className="board-cell board-actions" data-label="Actions">
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => onLoadLimit(account)}
            disabled={rowBusyMatch}
          >
            {rowBusyMatch && rowBusy.action === 'limit' ? 'Loading...' : 'Limit'}
          </button>
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => onUseNow(account)}
            disabled={rowBusyMatch}
          >
            {rowBusyMatch && rowBusy.action === 'use' ? 'Saving...' : 'Use'}
          </button>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => onEdit(account)}
            disabled={rowBusyMatch}
          >
            Edit
          </button>
        </div>
      ) : null}
    </article>
  )
}

function AccountBoard({
  title,
  subtitle,
  accounts,
  loading,
  error,
  now,
  adminMode = false,
  rowBusy,
  onEdit,
  onLoadLimit,
  onUseNow,
}) {
  return (
    <section className="panel board-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{adminMode ? 'Admin board' : 'Public board'}</p>
          <h2>{title}</h2>
        </div>
        <p className="muted-copy">{subtitle}</p>
      </div>

      {error ? <p className="section-banner error-banner">{error}</p> : null}
      {loading ? <p className="section-banner">Loading account data...</p> : null}

      {!loading && !accounts.length ? (
        <p className="section-banner">No accounts found.</p>
      ) : (
        <div className="board-shell">
          <div className={`board-head ${adminMode ? 'with-actions' : ''}`}>
            <span>Rank</span>
            <span>Account</span>
            <span>Status</span>
            <span>Countdown</span>
            <span>Reset time</span>
            <span>Last used</span>
            {adminMode ? <span>Actions</span> : null}
          </div>

          <div className="board-body">
            {accounts.map((account, index) => (
              <AccountBoardRow
                key={account.id}
                account={account}
                rank={index + 1}
                now={now}
                adminMode={adminMode}
                rowBusy={rowBusy}
                onEdit={onEdit}
                onLoadLimit={onLoadLimit}
                onUseNow={onUseNow}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function AdminLoginPanel({
  password,
  onPasswordChange,
  onSubmit,
  busy,
  error,
  authLoading,
}) {
  return (
    <section className="panel auth-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Protected access</p>
          <h2>Admin sign-in</h2>
        </div>
        <span className="status-badge status-red">Restricted</span>
      </div>

      <p className="muted-copy">
        Only <strong>{ADMIN_EMAIL}</strong> can create, edit, delete, and update
        account records.
      </p>

      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          <span>Admin email</span>
          <input value={ADMIN_EMAIL} readOnly />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Firebase Authentication password"
            required
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="drawer-footer inline-actions">
          <button type="submit" className="primary-button" disabled={busy || authLoading}>
            {busy ? 'Signing in...' : authLoading ? 'Checking session...' : 'Sign in'}
          </button>
        </div>
      </form>
    </section>
  )
}

function AccountDrawer({
  drawer,
  draft,
  busy,
  error,
  helperMessage,
  onClose,
  onSubmit,
  onDelete,
  onUseNow,
  onPasteClipboard,
  onFieldChange,
  onLimitMessageChange,
  previewSnapshot,
  parsedMessage,
  now,
}) {
  if (!drawer) {
    return null
  }

  const mode = drawer.mode
  const isEdit = mode === 'edit'

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{isEdit ? 'Edit account' : 'Create account'}</p>
            <h2 id="drawer-title">
              {isEdit ? draft.name || 'Account editor' : 'New account'}
            </h2>
          </div>

          <div className="drawer-header-actions">
            <StatusBadge status={previewSnapshot.status} />
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m6 6 12 12M18 6 6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="drawer-summary">
          <div>
            <span>Countdown</span>
            <strong>{previewSnapshot.countdownText}</strong>
          </div>
          <div>
            <span>Reset time</span>
            <strong>{formatBoardDateTime(previewSnapshot.resetAt, now)}</strong>
          </div>
          <div>
            <span>Last used</span>
            <strong>{formatBoardLastUsed(previewSnapshot.lastUsedAt, now)}</strong>
          </div>
          <div>
            <span>Score</span>
            <strong>{previewSnapshot.score}</strong>
          </div>
        </div>

        {helperMessage ? <p className="drawer-helper">{helperMessage}</p> : null}

        <form className="drawer-form" onSubmit={onSubmit}>
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => onFieldChange('name', event.target.value)}
                placeholder="Account 01"
                required
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                value={draft.email}
                onChange={(event) => onFieldChange('email', event.target.value)}
                placeholder="gmail@example.com"
                required
              />
            </label>

            <label>
              <span>Order index</span>
              <input
                type="number"
                min="1"
                value={draft.orderIndex}
                onChange={(event) => onFieldChange('orderIndex', event.target.value)}
              />
            </label>

            <label>
              <span>Last used</span>
              <input
                type="datetime-local"
                value={draft.lastUsedAtInput}
                onChange={(event) => onFieldChange('lastUsedAtInput', event.target.value)}
              />
            </label>
          </div>

          <label>
            <span>Limit message</span>
            <textarea
              value={draft.limitMessage}
              onChange={(event) => onLimitMessageChange(event.target.value)}
              placeholder="Paste the latest Codex limit message."
              rows="8"
            />
          </label>

          <div className="drawer-inline-actions">
            <button
              type="button"
              className="ghost-button compact"
              onClick={onPasteClipboard}
              disabled={busy}
            >
              Load clipboard
            </button>
            {isEdit ? (
              <button
                type="button"
                className="ghost-button compact"
                onClick={onUseNow}
                disabled={busy}
              >
                Use now
              </button>
            ) : null}
          </div>

          <div className="form-grid">
            <label>
              <span>Reset time override</span>
              <input
                type="datetime-local"
                value={draft.resetAtInput}
                onChange={(event) => onFieldChange('resetAtInput', event.target.value)}
              />
            </label>

            <label>
              <span>Notes</span>
              <textarea
                value={draft.notes}
                onChange={(event) => onFieldChange('notes', event.target.value)}
                placeholder="Internal notes"
                rows="4"
              />
            </label>
          </div>

          <div className="parser-panel">
            <strong>{parsedMessage.explanation}</strong>
            <span>
              Stored reset: {formatDateTime(previewSnapshot.resetAt)} | Last used:{' '}
              {formatLastUsed(previewSnapshot.lastUsedAt, now)}
            </span>
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <div className="drawer-footer">
            {isEdit ? (
              <button
                type="button"
                className="danger-button"
                onClick={onDelete}
                disabled={busy}
              >
                Delete
              </button>
            ) : (
              <span />
            )}

            <div className="inline-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy
                  ? mode === 'create'
                    ? 'Creating...'
                    : 'Saving...'
                  : mode === 'create'
                    ? 'Create account'
                    : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  )
}

function PublicDashboard({ accounts, loading, error, now }) {
  return (
    <AccountBoard
      title="Account board"
      subtitle="View-only ranking sorted from the best available account to the worst."
      accounts={accounts}
      loading={loading}
      error={error}
      now={now}
    />
  )
}

function AdminDashboard({
  accounts,
  loading,
  error,
  now,
  isAdmin,
  authLoading,
  authError,
  password,
  onPasswordChange,
  onLogin,
  loginBusy,
  rowBusy,
  onEdit,
  onLoadLimit,
  onUseNow,
}) {
  if (!isAdmin) {
    return (
      <AdminLoginPanel
        password={password}
        onPasswordChange={onPasswordChange}
        onSubmit={onLogin}
        busy={loginBusy}
        error={authError}
        authLoading={authLoading}
      />
    )
  }

  return (
    <AccountBoard
      title="Manage accounts"
      subtitle="Use one-click actions for last-used updates and fresh limit imports, or open the drawer for full edits."
      accounts={accounts}
      loading={loading}
      error={error}
      now={now}
      adminMode
      rowBusy={rowBusy}
      onEdit={onEdit}
      onLoadLimit={onLoadLimit}
      onUseNow={onUseNow}
    />
  )
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [view, setView] = useState(() => getViewFromHash(window.location.hash || PUBLIC_HASH))
  const [now, setNow] = useState(() => new Date())
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [password, setPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState(null)
  const [drawer, setDrawer] = useState(null)
  const [drawerDraft, setDrawerDraft] = useState(() => buildEmptyDraft())
  const [drawerBusy, setDrawerBusy] = useState(false)
  const [drawerError, setDrawerError] = useState('')

  const handleTick = useEffectEvent(() => {
    setNow(new Date())
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = PUBLIC_HASH
    }

    const syncView = () => {
      setView(getViewFromHash(window.location.hash))
    }

    syncView()
    window.addEventListener('hashchange', syncView)

    return () => {
      window.removeEventListener('hashchange', syncView)
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      handleTick()
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (user && user.email !== ADMIN_EMAIL) {
          setAuthError('Signed in with an unauthorized account.')
          await signOut(auth)
          startTransition(() => {
            setAuthUser(null)
            setAuthLoading(false)
          })
          return
        }

        startTransition(() => {
          setAuthUser(user)
          setAuthLoading(false)
        })
      },
      (authStateError) => {
        setAuthError(describeFirebaseError(authStateError))
        setAuthLoading(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, ACCOUNTS_COLLECTION),
      (snapshot) => {
        const nextAccounts = snapshot.docs.map(normalizeAccountDocument)

        startTransition(() => {
          setAccounts(nextAccounts)
          setLoading(false)
          setError('')
        })
      },
      (snapshotError) => {
        setLoading(false)
        setError(describeFirebaseError(snapshotError))
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null)
    }, 3500)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [notice])

  useEffect(() => {
    if (!drawer) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [drawer])

  const sortedAccounts = useMemo(() => sortAccounts(accounts, now), [accounts, now])
  const summary = useMemo(() => summarizeAccounts(sortedAccounts), [sortedAccounts])
  const analytics = useMemo(() => buildAnalytics(sortedAccounts, now), [sortedAccounts, now])
  const bestAccount = sortedAccounts[0] ?? null
  const drawerPreviewRecord = useMemo(
    () => buildAccountRecord(drawerDraft, now),
    [drawerDraft, now],
  )
  const drawerPreviewSnapshot = useMemo(
    () => getAccountSnapshot(drawerPreviewRecord, now),
    [drawerPreviewRecord, now],
  )
  const parsedDrawerMessage = useMemo(
    () => parseLimitMessage(drawerDraft.limitMessage),
    [drawerDraft.limitMessage],
  )

  function handleViewChange(nextView) {
    window.location.hash = nextView === 'admin' ? ADMIN_HASH : PUBLIC_HASH
  }

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  function openCreateDrawer() {
    setDrawer({ mode: 'create', helperMessage: '' })
    setDrawerDraft(buildEmptyDraft(accounts.length + 1))
    setDrawerError('')
  }

  function openEditDrawer(account, helperMessage = '') {
    setDrawer({ mode: 'edit', accountId: account.id, helperMessage })
    setDrawerDraft(buildDraftFromAccount(account))
    setDrawerError('')
  }

  function closeDrawer() {
    setDrawer(null)
    setDrawerBusy(false)
    setDrawerError('')
  }

  function updateDrawerField(field, value) {
    setDrawerDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function handleDrawerLimitMessageChange(value) {
    setDrawerDraft((current) => mergeLimitMessageIntoDraft(current, value))
  }

  async function persistAccountUpdate(account, nextDraft, extraFields = {}) {
    const payload = buildAccountRecord(nextDraft, new Date())

    await updateDoc(doc(db, ACCOUNTS_COLLECTION, account.id), {
      ...payload,
      ...extraFields,
      updatedAt: serverTimestamp(),
    })
  }

  async function handleDrawerPasteClipboard() {
    setDrawerBusy(true)
    setDrawerError('')

    try {
      const text = await readClipboardText()
      setDrawerDraft((current) =>
        mergeLimitMessageIntoDraft(current, text, { clearResetOnMissingParse: true }),
      )
    } catch (clipboardError) {
      setDrawerError(clipboardError.message)
    } finally {
      setDrawerBusy(false)
    }
  }

  async function handleDrawerSubmit(event) {
    event.preventDefault()

    if (!drawerDraft.name.trim() || !drawerDraft.email.trim()) {
      setDrawerError('Name and email are required.')
      return
    }

    setDrawerBusy(true)
    setDrawerError('')

    try {
      if (drawer?.mode === 'create') {
        const payload = buildAccountRecord(drawerDraft, new Date())

        await addDoc(collection(db, ACCOUNTS_COLLECTION), {
          ...payload,
          usageCount: 0,
          usageHistory: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })

        setNotice({ tone: 'success', message: 'Account created.' })
      } else if (drawer?.mode === 'edit' && drawer.accountId) {
        await persistAccountUpdate({ id: drawer.accountId }, drawerDraft)
        setNotice({ tone: 'success', message: 'Account updated.' })
      }

      closeDrawer()
    } catch (saveError) {
      setDrawerError(describeFirebaseError(saveError))
      setDrawerBusy(false)
    }
  }

  async function handleDeleteFromDrawer() {
    if (!drawer?.accountId) {
      return
    }

    const confirmed = window.confirm(`Delete ${drawerDraft.name || 'this account'}?`)

    if (!confirmed) {
      return
    }

    setDrawerBusy(true)
    setDrawerError('')

    try {
      await deleteDoc(doc(db, ACCOUNTS_COLLECTION, drawer.accountId))
      setNotice({ tone: 'success', message: 'Account deleted.' })
      closeDrawer()
    } catch (deleteError) {
      setDrawerError(describeFirebaseError(deleteError))
      setDrawerBusy(false)
    }
  }

  async function handleDrawerUseNow() {
    if (!drawer?.accountId) {
      return
    }

    const currentAccount = accounts.find((account) => account.id === drawer.accountId)

    if (!currentAccount) {
      setDrawerError('Account record no longer exists.')
      return
    }

    const when = new Date()
    const nextDraft = {
      ...drawerDraft,
      lastUsedAtInput: toDateTimeLocalValue(when),
    }

    setDrawerDraft(nextDraft)
    setDrawerBusy(true)
    setDrawerError('')

    try {
      await persistAccountUpdate(currentAccount, nextDraft, buildUsageUpdate(currentAccount, when))
      setNotice({ tone: 'success', message: `${currentAccount.name} marked as used.` })
    } catch (saveError) {
      setDrawerError(describeFirebaseError(saveError))
    } finally {
      setDrawerBusy(false)
    }
  }

  async function handleQuickUse(account) {
    const busyState = { accountId: account.id, action: 'use' }
    const when = new Date()
    const nextDraft = {
      ...buildDraftFromAccount(account),
      lastUsedAtInput: toDateTimeLocalValue(when),
    }

    setRowBusy(busyState)
    setNotice(null)

    try {
      await persistAccountUpdate(account, nextDraft, buildUsageUpdate(account, when))
      setNotice({ tone: 'success', message: `${account.name} marked as used.` })
    } catch (saveError) {
      setNotice({ tone: 'error', message: describeFirebaseError(saveError) })
    } finally {
      setRowBusy(null)
    }
  }

  async function handleQuickLimit(account) {
    const busyState = { accountId: account.id, action: 'limit' }

    setRowBusy(busyState)
    setNotice(null)

    try {
      const text = await readClipboardText()
      const nextDraft = mergeLimitMessageIntoDraft(buildDraftFromAccount(account), text, {
        clearResetOnMissingParse: true,
      })

      await persistAccountUpdate(account, nextDraft)
      setNotice({ tone: 'success', message: `Latest limit message loaded for ${account.name}.` })
    } catch (clipboardError) {
      setNotice({
        tone: 'error',
        message: `${clipboardError.message} Opening manual editor instead.`,
      })
      openEditDrawer(account, 'Clipboard text could not be loaded. Paste the message manually here.')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleSignOut() {
    setAuthError('')
    await signOut(auth)
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginBusy(true)
    setAuthError('')

    try {
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password)
      setPassword('')
    } catch (loginError) {
      setAuthError(describeFirebaseError(loginError))
    } finally {
      setLoginBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        onViewChange={handleViewChange}
        theme={theme}
        onToggleTheme={toggleTheme}
        isAdmin={Boolean(authUser)}
        onSignOut={handleSignOut}
        onOpenCreate={openCreateDrawer}
      />

      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />

      <main className="page-content">
        <SummarySection bestAccount={bestAccount} summary={summary} now={now} />
        <AnalyticsSection analytics={analytics} />

        {view === 'public' ? (
          <PublicDashboard
            accounts={sortedAccounts}
            loading={loading}
            error={error}
            now={now}
          />
        ) : (
          <AdminDashboard
            accounts={sortedAccounts}
            loading={loading}
            error={error}
            now={now}
            isAdmin={Boolean(authUser)}
            authLoading={authLoading}
            authError={authError}
            password={password}
            onPasswordChange={setPassword}
            onLogin={handleLogin}
            loginBusy={loginBusy}
            rowBusy={rowBusy}
            onEdit={openEditDrawer}
            onLoadLimit={handleQuickLimit}
            onUseNow={handleQuickUse}
          />
        )}
      </main>

      <AccountDrawer
        drawer={drawer}
        draft={drawerDraft}
        busy={drawerBusy}
        error={drawerError}
        helperMessage={drawer?.helperMessage}
        onClose={closeDrawer}
        onSubmit={handleDrawerSubmit}
        onDelete={handleDeleteFromDrawer}
        onUseNow={handleDrawerUseNow}
        onPasteClipboard={handleDrawerPasteClipboard}
        onFieldChange={updateDrawerField}
        onLimitMessageChange={handleDrawerLimitMessageChange}
        previewSnapshot={drawerPreviewSnapshot}
        parsedMessage={parsedDrawerMessage}
        now={now}
      />
    </div>
  )
}

export default App
