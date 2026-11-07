import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { get, post } from '../../lib/api'
import { GuestHeader } from '../../components/AppHeader'
import { Field } from '../../components/Controls'
import { LinkUnavailable, Loading } from '../../components/States'

/**
 * Joining by a retreat's group link: just a name, then straight into their own review. Confirming an
 * email comes later, optionally, on the thank-you page, like everyone else. The page remembers, on this
 * device, whose review it opened, so coming back to the group link continues it instead of adding
 * someone new (with no email yet, this device is how they find their review again).
 */
const remembered = (token: string) => {
  try {
    return window.localStorage.getItem(`croot:group:${token}`)
  } catch {
    return null
  }
}

export default function GroupJoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const info = useQuery({
    queryKey: ['group', token],
    queryFn: () => get<{ retreatTitle: string; organiser: string; kind: 'itinerary' | 'property'; privacyNoticePath: string; full: boolean }>(`/api/group/${token}`),
    retry: false,
  })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mine = remembered(token)

  if (info.error) return <LinkUnavailable message={(info.error as Error).message} />
  if (!info.data) return <Loading />
  const d = info.data
  const visit = d.kind === 'property' ? 'stay' : 'retreat'

  async function join(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ reviewPath: string }>(`/api/group/${token}/join`, { name })
      try {
        window.localStorage.setItem(`croot:group:${token}`, r.reviewPath)
      } catch {
        /* private mode: they just won't be taken back automatically */
      }
      navigate(r.reviewPath)
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
        <h1>How was your {visit}?</h1>
        {mine ? (
          <>
            <p>You’ve already started your review on this device.</p>
            <div className="row">
              <Link className="btn" to={mine}>
                Continue my review
              </Link>
            </div>
          </>
        ) : d.full ? (
          <p className="notice warn">This link has been used by as many people as it allows. Please contact {d.organiser} for your own link.</p>
        ) : (
          <>
            <p>{d.organiser} would love to hear how it went. It takes a few minutes, every question is optional, and nothing is published unless you choose.</p>
            <form className="stack" onSubmit={(e) => void join(e)} noValidate>
              <Field id="join-name" label="Your name" hint="So the organiser knows who the review is from.">
                <input id="join-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </Field>
              <div className="row">
                <button type="submit" className="btn" disabled={busy || !name.trim()}>
                  {busy ? 'Starting…' : 'Start my review'}
                </button>
              </div>
            </form>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small muted">
          <Link to={d.privacyNoticePath}>How your information is used</Link>
        </p>
      </div>
    </main>
  )
}
