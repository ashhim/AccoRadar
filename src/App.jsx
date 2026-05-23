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
  formatDateTime,
  formatLastUsed,
  getAccountSnapshot,
  parseLimitMessage,
  sortAccounts,
  STATUS_CONFIG,
  toDate,
  toDateTimeLocalValue,
} from './lib/account-utils'

const ACCOUNTS_COLLECTION = 'accounts'
const PUBLIC_HASH = '#/public'
const ADMIN_HASH = '#/admin'

function getViewFromHash(hash) {
  return hash.toLowerCase().includes('admin') ? 'admin' : 'public'
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

function getStatusClass(status) {
  return `status-pill status-${status}`
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

function AppHeader({ view, onViewChange, isAdmin, onSignOut }) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <p className="eyebrow">AccoRadar</p>
        <h1>Codex account radar</h1>
        <p className="lede">
          Rank every Gmail account by availability, reset time, and reuse
          priority.
        </p>
      </div>

      <div className="topbar-actions">
        <nav className="view-switch" aria-label="Dashboard views">
          <button
            type="button"
            className={view === 'public' ? 'is-active' : ''}
            onClick={() => onViewChange('public')}
          >
            Public board
          </button>
          <button
            type="button"
            className={view === 'admin' ? 'is-active' : ''}
            onClick={() => onViewChange('admin')}
          >
            Admin panel
          </button>
        </nav>

        {isAdmin ? (
          <button type="button" className="secondary-button" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  )
}

function SummaryStrip({ summary }) {
  const cards = [
    { label: 'Ready now', value: summary.green, tone: 'green' },
    { label: 'Reset soon', value: summary.yellow, tone: 'yellow' },
    { label: 'Blocked', value: summary.red, tone: 'red' },
    { label: 'Tracked accounts', value: summary.total, tone: 'neutral' },
  ]

  return (
    <section className="summary-strip" aria-label="Account summary">
      {cards.map((card) => (
        <article key={card.label} className={`summary-card tone-${card.tone}`}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
        </article>
      ))}
    </section>
  )
}

function HighlightPanel({ bestAccount }) {
  if (!bestAccount) {
    return (
      <section className="highlight-panel">
        <div>
          <p className="eyebrow">Best next account</p>
          <h2>No accounts yet</h2>
          <p className="muted-copy">
            Create the first account from the admin panel to start ranking them.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="highlight-panel">
      <div>
        <p className="eyebrow">Best next account</p>
        <h2>{bestAccount.name}</h2>
        <p className="highlight-email">{bestAccount.email}</p>
      </div>

      <div className="highlight-metrics">
        <span className={getStatusClass(bestAccount.snapshot.status)}>
          {bestAccount.snapshot.priorityLabel}
        </span>
        <div>
          <small>Countdown</small>
          <strong>{bestAccount.snapshot.countdownText}</strong>
        </div>
        <div>
          <small>Reset time</small>
          <strong>{formatDateTime(bestAccount.snapshot.resetAt)}</strong>
        </div>
        <div>
          <small>Score</small>
          <strong>{bestAccount.snapshot.score}</strong>
        </div>
      </div>
    </section>
  )
}

function AccountCard({ account, rank, now, adminMode = false }) {
  const snapshot = account.snapshot ?? getAccountSnapshot(account, now)

  return (
    <article className="account-card">
      <div className="account-card-header">
        <div>
          <div className="card-rank">#{rank}</div>
          <h3>{account.name}</h3>
          <p className="account-email">{account.email}</p>
        </div>

        <div className="card-header-side">
          <span className={getStatusClass(snapshot.status)}>
            {STATUS_CONFIG[snapshot.status].shortLabel}
          </span>
          <strong className="score-badge">Score {snapshot.score}</strong>
        </div>
      </div>

      <p className="status-reason">{snapshot.reason}</p>

      <dl className="metric-grid">
        <div>
          <dt>Countdown</dt>
          <dd>{snapshot.countdownText}</dd>
        </div>
        <div>
          <dt>Reset time</dt>
          <dd>{formatDateTime(snapshot.resetAt)}</dd>
        </div>
        <div>
          <dt>Last used</dt>
          <dd>{formatLastUsed(snapshot.lastUsedAt, now)}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{snapshot.priorityLabel}</dd>
        </div>
      </dl>

      {account.limitMessage ? (
        <details className="message-box">
          <summary>Stored limit message</summary>
          <p>{account.limitMessage}</p>
        </details>
      ) : null}

      {adminMode && account.notes ? (
        <div className="note-box">
          <strong>Notes</strong>
          <p>{account.notes}</p>
        </div>
      ) : null}
    </article>
  )
}

function CreateAccountPanel({
  draft,
  onDraftChange,
  onLimitMessageChange,
  onSubmit,
  busy,
  error,
  now,
}) {
  const previewRecord = useMemo(() => buildAccountRecord(draft, now), [draft, now])
  const previewSnapshot = useMemo(
    () => getAccountSnapshot(previewRecord, now),
    [previewRecord, now],
  )
  const parsedMessage = useMemo(
    () => parseLimitMessage(draft.limitMessage),
    [draft.limitMessage],
  )

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin tools</p>
          <h2>Create account</h2>
        </div>
        <span className={getStatusClass(previewSnapshot.status)}>
          Preview {previewSnapshot.priorityLabel}
        </span>
      </div>

      <form className="editor-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => onDraftChange('name', event.target.value)}
              placeholder="Account 01"
              required
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={draft.email}
              onChange={(event) => onDraftChange('email', event.target.value)}
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
              onChange={(event) => onDraftChange('orderIndex', event.target.value)}
            />
          </label>

          <label>
            <span>Last used</span>
            <input
              type="datetime-local"
              value={draft.lastUsedAtInput}
              onChange={(event) => onDraftChange('lastUsedAtInput', event.target.value)}
            />
          </label>
        </div>

        <label>
          <span>Limit message</span>
          <textarea
            value={draft.limitMessage}
            onChange={(event) => onLimitMessageChange(event.target.value)}
            placeholder="Paste the Codex limit message here."
            rows="5"
          />
        </label>

        <div className="form-grid">
          <label>
            <span>Reset time override</span>
            <input
              type="datetime-local"
              value={draft.resetAtInput}
              onChange={(event) => onDraftChange('resetAtInput', event.target.value)}
            />
          </label>

          <label>
            <span>Notes</span>
            <textarea
              value={draft.notes}
              onChange={(event) => onDraftChange('notes', event.target.value)}
              placeholder="Optional notes"
              rows="3"
            />
          </label>
        </div>

        <div className="parser-panel">
          <strong>{parsedMessage.explanation}</strong>
          <span>
            Preview countdown: {previewSnapshot.countdownText} | Score:{' '}
            {previewSnapshot.score}
          </span>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Creating...' : 'Create account'}
          </button>
        </div>
      </form>
    </section>
  )
}

function AccountEditorCard({ account, now }) {
  const [draft, setDraft] = useState(() => buildDraftFromAccount(account))
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const previewRecord = useMemo(() => buildAccountRecord(draft, now), [draft, now])
  const previewSnapshot = useMemo(
    () => getAccountSnapshot(previewRecord, now),
    [previewRecord, now],
  )
  const parsedMessage = useMemo(
    () => parseLimitMessage(draft.limitMessage),
    [draft.limitMessage],
  )

  function updateField(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function handleLimitMessageChange(value) {
    const parsed = parseLimitMessage(value)

    setDraft((current) => ({
      ...current,
      limitMessage: value,
      resetAtInput: parsed.resetAt
        ? toDateTimeLocalValue(parsed.resetAt)
        : value.trim()
          ? current.resetAtInput
          : '',
    }))
  }

  async function handleSave(event) {
    event.preventDefault()

    if (!draft.name.trim() || !draft.email.trim()) {
      setError('Name and email are required.')
      return
    }

    setBusy(true)
    setError('')

    try {
      const payload = buildAccountRecord(draft, new Date())

      await updateDoc(doc(db, ACCOUNTS_COLLECTION, account.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      })
    } catch (saveError) {
      setError(describeFirebaseError(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkUsedNow() {
    const nextDraft = {
      ...draft,
      lastUsedAtInput: toDateTimeLocalValue(new Date()),
    }

    setDraft(nextDraft)
    setBusy(true)
    setError('')

    try {
      const payload = buildAccountRecord(nextDraft, new Date())

      await updateDoc(doc(db, ACCOUNTS_COLLECTION, account.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      })
    } catch (saveError) {
      setError(describeFirebaseError(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${account.name}?`)

    if (!confirmed) {
      return
    }

    setDeleting(true)
    setError('')

    try {
      await deleteDoc(doc(db, ACCOUNTS_COLLECTION, account.id))
    } catch (deleteError) {
      setError(describeFirebaseError(deleteError))
    } finally {
      setDeleting(false)
    }
  }

  function handleReset() {
    setDraft(buildDraftFromAccount(account))
    setError('')
  }

  return (
    <article className="editor-card">
      <div className="editor-card-header">
        <div>
          <div className="card-rank">#{account.rank}</div>
          <h3>{account.name}</h3>
          <p className="account-email">{account.email}</p>
        </div>

        <div className="editor-header-actions">
          <span className={getStatusClass(previewSnapshot.status)}>
            {previewSnapshot.priorityLabel}
          </span>
          <strong className="score-badge">Score {previewSnapshot.score}</strong>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Collapse' : 'Edit'}
          </button>
        </div>
      </div>

      <div className="editor-quick-grid">
        <div>
          <span>Countdown</span>
          <strong>{previewSnapshot.countdownText}</strong>
        </div>
        <div>
          <span>Reset time</span>
          <strong>{formatDateTime(previewSnapshot.resetAt)}</strong>
        </div>
        <div>
          <span>Last used</span>
          <strong>{formatLastUsed(previewSnapshot.lastUsedAt, now)}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{previewSnapshot.reason}</strong>
        </div>
      </div>

      {expanded ? (
        <form className="editor-form" onSubmit={handleSave}>
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                value={draft.email}
                onChange={(event) => updateField('email', event.target.value)}
                required
              />
            </label>

            <label>
              <span>Order index</span>
              <input
                type="number"
                min="1"
                value={draft.orderIndex}
                onChange={(event) => updateField('orderIndex', event.target.value)}
              />
            </label>

            <label>
              <span>Last used</span>
              <input
                type="datetime-local"
                value={draft.lastUsedAtInput}
                onChange={(event) => updateField('lastUsedAtInput', event.target.value)}
              />
            </label>
          </div>

          <label>
            <span>Limit message</span>
            <textarea
              value={draft.limitMessage}
              onChange={(event) => handleLimitMessageChange(event.target.value)}
              rows="5"
            />
          </label>

          <div className="form-grid">
            <label>
              <span>Reset time override</span>
              <input
                type="datetime-local"
                value={draft.resetAtInput}
                onChange={(event) => updateField('resetAtInput', event.target.value)}
              />
            </label>

            <label>
              <span>Notes</span>
              <textarea
                value={draft.notes}
                onChange={(event) => updateField('notes', event.target.value)}
                rows="3"
              />
            </label>
          </div>

          <div className="parser-panel">
            <strong>{parsedMessage.explanation}</strong>
            <span>
              Live preview: {previewSnapshot.countdownText} | Score:{' '}
              {previewSnapshot.score}
            </span>
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleMarkUsedNow}
              disabled={busy || deleting}
            >
              Mark used now
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleReset}
              disabled={busy || deleting}
            >
              Revert
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={handleDelete}
              disabled={busy || deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || deleting}
            >
              {busy ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : null}
    </article>
  )
}

function PublicDashboard({ accounts, loading, error, now }) {
  const bestAccount = accounts[0]

  return (
    <>
      <HighlightPanel bestAccount={bestAccount} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Public dashboard</p>
            <h2>Account board</h2>
          </div>
          <p className="muted-copy">
            Live countdowns refresh every second and the list stays sorted from
            best to worst.
          </p>
        </div>

        {error ? <p className="banner error-banner">{error}</p> : null}
        {loading ? <p className="banner">Loading account data...</p> : null}

        {!loading && !accounts.length ? (
          <p className="banner">No accounts found.</p>
        ) : (
          <div className="account-grid">
            {accounts.map((account, index) => (
              <AccountCard
                key={account.id}
                account={account}
                rank={index + 1}
                now={now}
              />
            ))}
          </div>
        )}
      </section>
    </>
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
          <p className="eyebrow">Protected view</p>
          <h2>Admin sign-in</h2>
        </div>
        <span className="status-pill status-red">Restricted</span>
      </div>

      <p className="muted-copy">
        Only <strong>{ADMIN_EMAIL}</strong> can edit account data.
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

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy || authLoading}>
            {busy ? 'Signing in...' : authLoading ? 'Checking session...' : 'Sign in'}
          </button>
        </div>
      </form>
    </section>
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
  setPassword,
  onLogin,
  loginBusy,
  createDraft,
  onCreateDraftChange,
  onCreateLimitMessageChange,
  onCreateAccount,
  createBusy,
  createError,
}) {
  if (!isAdmin) {
    return (
      <AdminLoginPanel
        password={password}
        onPasswordChange={setPassword}
        onSubmit={onLogin}
        busy={loginBusy}
        error={authError}
        authLoading={authLoading}
      />
    )
  }

  return (
    <>
      <CreateAccountPanel
        draft={createDraft}
        onDraftChange={onCreateDraftChange}
        onLimitMessageChange={onCreateLimitMessageChange}
        onSubmit={onCreateAccount}
        busy={createBusy}
        error={createError}
        now={now}
      />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Admin dashboard</p>
            <h2>Manage accounts</h2>
          </div>
          <p className="muted-copy">
            Paste new limit messages into any account and the ranking updates
            immediately.
          </p>
        </div>

        {error ? <p className="banner error-banner">{error}</p> : null}
        {loading ? <p className="banner">Loading account data...</p> : null}

        {!loading && !accounts.length ? (
          <p className="banner">No accounts found.</p>
        ) : (
          <div className="editor-list">
            {accounts.map((account, index) => (
              <AccountEditorCard
                key={`${account.id}-${account.updatedAt?.getTime() ?? 0}`}
                account={{ ...account, rank: index + 1 }}
                now={now}
              />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function App() {
  const [view, setView] = useState(() => getViewFromHash(window.location.hash || PUBLIC_HASH))
  const [now, setNow] = useState(() => new Date())
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [password, setPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [createDraft, setCreateDraft] = useState(() => buildEmptyDraft())
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')

  const handleTick = useEffectEvent(() => {
    setNow(new Date())
  })

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
          setCreateDraft((current) =>
            current.name || current.email || current.limitMessage || current.notes
              ? current
              : buildEmptyDraft(nextAccounts.length + 1),
          )
        })
      },
      (snapshotError) => {
        setLoading(false)
        setError(describeFirebaseError(snapshotError))
      },
    )

    return unsubscribe
  }, [])

  const sortedAccounts = useMemo(() => sortAccounts(accounts, now), [accounts, now])
  const summary = useMemo(() => summarizeAccounts(sortedAccounts), [sortedAccounts])

  function handleViewChange(nextView) {
    window.location.hash = nextView === 'admin' ? ADMIN_HASH : PUBLIC_HASH
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

  function updateCreateDraft(field, value) {
    setCreateDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function handleCreateLimitMessageChange(value) {
    const parsed = parseLimitMessage(value)

    setCreateDraft((current) => ({
      ...current,
      limitMessage: value,
      resetAtInput: parsed.resetAt
        ? toDateTimeLocalValue(parsed.resetAt)
        : value.trim()
          ? current.resetAtInput
          : '',
    }))
  }

  async function handleCreateAccount(event) {
    event.preventDefault()

    if (!createDraft.name.trim() || !createDraft.email.trim()) {
      setCreateError('Name and email are required.')
      return
    }

    setCreateBusy(true)
    setCreateError('')

    try {
      const payload = buildAccountRecord(createDraft, new Date())

      await addDoc(collection(db, ACCOUNTS_COLLECTION), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      setCreateDraft(buildEmptyDraft(accounts.length + 2))
    } catch (createAccountError) {
      setCreateError(describeFirebaseError(createAccountError))
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        onViewChange={handleViewChange}
        isAdmin={Boolean(authUser)}
        onSignOut={handleSignOut}
      />

      <SummaryStrip summary={summary} />

      <main className="page-content">
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
            setPassword={setPassword}
            onLogin={handleLogin}
            createDraft={createDraft}
            onCreateDraftChange={updateCreateDraft}
            onCreateLimitMessageChange={handleCreateLimitMessageChange}
            onCreateAccount={handleCreateAccount}
            loginBusy={loginBusy}
            createBusy={createBusy}
            createError={createError}
          />
        )}
      </main>
    </div>
  )
}

export default App
