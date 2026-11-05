import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { GuestHeader } from '../../components/AppHeader'

/** /interest/:token (confirm) and /interest/:token/unsubscribe, from the emails. */
export default function InterestLink({ action }: { action: 'confirm' | 'unsubscribe' }) {
  const { token = '' } = useParams()
  const [state, setState] = useState<{ orgName: string; orgSlug: string } | { error: string } | null>(null)
  const done = useRef(false)

  useEffect(() => {
    // Unsubscribing happens only on a click (mail scanners open links); confirming happens on open.
    if (action === 'confirm' && !done.current) {
      done.current = true
      void run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  async function run() {
    const res = await fetch(`/api/public/interest/${token}/${action}`, { method: 'POST', credentials: 'omit' })
    const body = await res.json().catch(() => ({}))
    setState(res.ok ? body : { error: body.error ?? 'This link didn’t work.' })
  }

  return (
    <main className="calm">
      <GuestHeader />
      <div className="narrow stack" style={{ padding: '4rem 0' }}>
        {state && 'error' in state ? (
          <>
            <h1>That link didn’t work</h1>
            <p className="muted">{state.error}</p>
          </>
        ) : state ? (
          action === 'confirm' ? (
            <>
              <h1>You’re on the list</h1>
              <p>{state.orgName} will email you about their next retreat. Every email has a link to unsubscribe.</p>
              <Link className="btn secondary" to={`/o/${state.orgSlug}`}>
                See {state.orgName}’s retreats
              </Link>
            </>
          ) : (
            <>
              <h1>You’ve unsubscribed</h1>
              <p>You won’t get any more emails from {state.orgName} about future retreats, and your email address has been deleted.</p>
            </>
          )
        ) : action === 'confirm' ? (
          <p className="muted">Confirming…</p>
        ) : (
          <>
            <h1>Unsubscribe?</h1>
            <p>You’ll stop getting emails about future retreats, and your email address will be deleted.</p>
            <div className="row">
              <button type="button" className="btn" onClick={() => void run()}>
                Unsubscribe
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
