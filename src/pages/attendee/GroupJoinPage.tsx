import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { get, post } from '../../lib/api'
import { useAuth, type Session } from '../../lib/auth'
import { GuestHeader } from '../../components/AppHeader'
import { Field } from '../../components/Controls'
import { LinkUnavailable, Loading } from '../../components/States'

/**
 * Joining by a retreat's group link: name and email, then a code emailed to that address. Only then
 * does the person get their own review link (signed in, so their review shows "Verified email").
 */
export default function GroupJoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const info = useQuery({
    queryKey: ['group', token],
    queryFn: () => get<{ retreatTitle: string; organiser: string; kind: 'itinerary' | 'property'; privacyNoticePath: string }>(`/api/group/${token}`),
    retry: false,
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (info.error) return <LinkUnavailable message={(info.error as Error).message} />
  if (!info.data) return <Loading />
  const d = info.data

  async function start(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ sentTo: string }>(`/api/group/${token}/start`, { name, email })
      setSentTo(r.sentTo)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await post<Session & { reviewPath: string }>(`/api/group/${token}/confirm`, { email, code })
      setSession(r)
      navigate(r.reviewPath, { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="calm">
      <GuestHeader />
      <div className="narrow stack" style={{ padding: '3rem 0 4rem' }}>
        <p className="eyebrow">{d.retreatTitle}</p>
        <h1>Share how your {d.kind === 'property' ? 'stay' : 'retreat'} was</h1>
        <p>
          {d.organiser} would love to hear from you. First, confirm your email: your review then shows as <strong>✓ Verified email</strong>, so future
          guests know it’s genuine, and you can come back to change it any time.
        </p>
        {!sentTo ? (
          <form className="stack" onSubmit={(e) => void start(e)} noValidate>
            <Field id="join-name" label="Your name">
              <input id="join-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field id="join-email" label="Your email" hint="We email you a 6-digit code to confirm it’s yours.">
              <input id="join-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <div className="row">
              <button type="submit" className="btn" disabled={busy || !name.trim() || !email.trim()}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </div>
          </form>
        ) : (
          <form className="stack" onSubmit={(e) => void confirm(e)}>
            <p role="status">
              We’ve sent a code to <strong>{sentTo}</strong>. It expires in a few minutes.
            </p>
            <Field id="join-code" label="Code from the email">
              <input
                id="join-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                style={{ maxWidth: '9rem', fontSize: '1.25rem', letterSpacing: '0.25em', textAlign: 'center' }}
              />
            </Field>
            <div className="row">
              <button type="submit" className="btn" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Continue to my review'}
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => void start()}>
                Send a new code
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => setSentTo(null)}>
                Use a different email
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small muted">
          We use your email only to confirm and manage your review. We won’t send you marketing without your consent, and we never share your email
          with anyone else. <Link to={d.privacyNoticePath}>How your information is used</Link>
        </p>
      </div>
    </main>
  )
}
