import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { get, post } from '../../lib/api'
import { GuestHeader } from '../../components/AppHeader'
import { LinkUnavailable, Loading } from '../../components/States'

/**
 * From a verification email the organiser asked Croot to send: one click confirms the review is the
 * guest's. Opening the page changes nothing (email scanners open links); only the button does.
 */
export default function VerifyReviewPage() {
  const { token = '' } = useParams()
  const q = useQuery({ queryKey: ['verify', token], queryFn: () => get<{ firstName: string; retreatTitle: string; verified: boolean }>(`/api/verify/${token}`), retry: false })
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (q.error) return <LinkUnavailable message={(q.error as Error).message} />
  if (!q.data) return <Loading />
  const verified = done || q.data.verified
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await post(`/api/verify/${token}`)
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="calm">
      <GuestHeader />
      <div className="narrow stack" style={{ padding: '4rem 0' }}>
        <p className="eyebrow">{q.data.retreatTitle}</p>
        {verified ? (
          <>
            <h1>
              <span aria-hidden="true">✓</span> Thank you, {q.data.firstName}
            </h1>
            <p>Your review is confirmed. It shows as <strong>Verified email</strong>, so future guests know it’s genuine.</p>
          </>
        ) : (
          <>
            <h1>Is this review yours, {q.data.firstName}?</h1>
            <p>Confirming marks your review of {q.data.retreatTitle} as <strong>✓ Verified email</strong>. Nothing else changes.</p>
            <div className="row">
              <button type="button" className="btn" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Confirming…' : 'Yes, it’s my review'}
              </button>
            </div>
            <p className="small muted">If you didn’t write a review, just close this page.</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}
