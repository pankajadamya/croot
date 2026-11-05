import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError, get, post } from '../lib/api'
import { useAuth, type Session } from '../lib/auth'
import { Field } from '../components/Controls'

interface Providers {
  google: boolean
  emailCode: boolean
  password: boolean
  organiserSignup: boolean
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'That sign-in attempt expired. Please try again.',
  google_failed: 'Google sign-in didn’t work. Please try again or use an email code.',
  google_unverified: 'Your Google account’s email address isn’t verified.',
  google_unavailable: 'Google sign-in isn’t available right now.',
  no_account: 'There’s no account or invitation for that Google address. Use the email address your invitation was sent to.',
  account_disabled: 'This account has been disabled.',
}

/** Only same-site paths, never another origin. */
function safeNext(value: string | null | undefined): string | null {
  return value && /^\/(?!\/)/.test(value) ? value : null
}

/**
 * One sign-in page for everyone. Guests sign in with the email their invitation went to; organisers
 * are onboarded with one-time links and then use any method here.
 */
export default function SignIn() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { session, setSession } = useAuth()
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: () => get<Providers>('/api/auth/providers') })
  const next = safeNext(params.get('next')) ?? safeNext((location.state as { from?: string } | null)?.from)

  const [mode, setMode] = useState<'email' | 'code' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(GOOGLE_ERRORS[params.get('error') ?? ''] ?? null)
  const [info, setInfo] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  function landing(s: Session) {
    if (next) return next
    return s.memberships.length || s.user.isPlatformAdmin ? '/admin' : '/my-reviews'
  }

  useEffect(() => {
    if (session) navigate(landing(session), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    if (mode === 'code') codeRef.current?.focus()
  }, [mode])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const requestCode = (e?: FormEvent) => {
    e?.preventDefault()
    return run(async () => {
      const r = await post<{ message: string }>('/api/auth/code/request', { email })
      setInfo(`${r.message} Check your inbox (and spam folder) for a 6-digit code.`)
      setMode('code')
    })
  }

  const verify = (e: FormEvent) => {
    e.preventDefault()
    return run(async () => {
      setSession(await post<Session>('/api/auth/code/verify', { email, code }))
    })
  }

  const passwordLogin = (e: FormEvent) => {
    e.preventDefault()
    return run(async () => {
      setSession(await post<Session>('/api/auth/login', { email, password }))
    })
  }

  return (
    <main className="calm">
      <div className="narrow" style={{ maxWidth: 460, padding: '4rem 0' }}>
        <Link to="/" className="brand">
          <img className="brand-logo" src="/croot-logo.svg" alt="Croot" />
        </Link>
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h1 style={{ fontSize: '1.8rem' }}>Sign in</h1>
          <p className="muted small">
            One sign-in for everyone. We’ll take you to the right place: your reviews, or your organiser workspace if you’ve been given access.
            Reviewing a retreat? Use the email address your invitation was sent to. Your unique link still works too.
          </p>
          {error && (
            <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}
          {info && mode === 'code' && (
            <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>
              {info}
            </div>
          )}

          {mode === 'email' && (
            <form onSubmit={requestCode}>
              <Field id="email" label="Email address">
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <button className="btn" style={{ width: '100%' }} disabled={busy || !email}>
                {busy ? 'Sending…' : 'Email me a sign-in code'}
              </button>
            </form>
          )}

          {mode === 'code' && (
            <form onSubmit={verify}>
              <Field id="code" label={`Code sent to ${email}`} hint="It expires in 10 minutes.">
                <input
                  ref={codeRef}
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{ fontSize: '1.5rem', letterSpacing: '0.4em', textAlign: 'center' }}
                />
              </Field>
              <button className="btn" style={{ width: '100%' }} disabled={busy || code.replace(/\s/g, '').length !== 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <div className="spread small" style={{ marginTop: '0.75rem' }}>
                <button type="button" className="btn ghost small" onClick={() => setMode('email')}>
                  Use a different email
                </button>
                <button type="button" className="btn ghost small" disabled={busy} onClick={() => void requestCode()}>
                  Send a new code
                </button>
              </div>
            </form>
          )}

          {mode === 'password' && (
            <form onSubmit={passwordLogin}>
              <Field id="pw-email" label="Email address">
                <input id="pw-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field id="password" label="Password">
                <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <button className="btn" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {providers.data?.google && (
            <>
              <div className="or-divider" aria-hidden="true">
                <span>or</span>
              </div>
              <a className="btn secondary google-btn" href={`/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
                  <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
                  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
                </svg>
                Continue with Google
              </a>
            </>
          )}

          <p className="small" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
            {mode === 'password' ? (
              <button type="button" className="btn ghost small" onClick={() => setMode('email')}>
                Use an email code instead
              </button>
            ) : (
              <button type="button" className="btn ghost small" onClick={() => setMode('password')}>
                Sign in with a password instead
              </button>
            )}
          </p>
        </div>
        <p className="small muted" style={{ marginTop: '1rem' }}>
          By signing in you agree to the use of one essential cookie to keep you signed in. See <Link to="/legal/privacy">privacy</Link> and{' '}
          <Link to="/legal/cookies">cookies</Link>.
        </p>
      </div>
    </main>
  )
}
