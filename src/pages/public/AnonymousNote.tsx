import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { api, ApiError, get } from '../../lib/api'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'

const CATEGORIES = [
  ['', 'No particular topic'],
  ['instruction', 'Classes and instruction'],
  ['accommodation', 'Accommodation'],
  ['food', 'Food'],
  ['travel', 'Travel and transfers'],
  ['safety', 'Safety or wellbeing'],
  ['people', 'People and group'],
  ['other', 'Something else'],
] as const

/**
 * Independent page, addressed only by public slugs. It is never given an invite token, it sends no
 * attendee identity, and there is deliberately no "return to my response" link from here.
 */
export default function AnonymousNote() {
  const { orgSlug = '', retreatSlug = '' } = useParams()
  const path = `/api/public/orgs/${orgSlug}/retreats/${retreatSlug}/anonymous`
  const info = useQuery({
    queryKey: ['anon', orgSlug, retreatSlug],
    queryFn: () => get<{ org: { name: string }; retreat: { title: string; organiserName: string; privacyUrl: string | null }; open: boolean }>(path),
  })
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (message.trim().length < 3) {
      setError('Please write your note before sending.')
      return
    }
    setState('sending')
    try {
      // No cookies or referrer: nothing in this request can identify the writer's browser session.
      await api('POST', path, { message, ...(category ? { category } : {}) }, { credentials: 'omit' })
      setState('sent')
      setMessage('')
    } catch (err) {
      setState('idle')
      setError(err instanceof ApiError ? err.message : 'Could not send. Please try again.')
    }
  }

  if (info.isLoading) return <Loading />
  if (info.error)
    return (
      <main className="calm">
        <div className="narrow" style={{ padding: '3rem 0' }}>
          <ErrorNotice error={info.error} />
        </div>
      </main>
    )
  const d = info.data!

  return (
    <main className="calm">
      <div className="narrow" style={{ padding: '3rem 0 5rem' }}>
        <p className="eyebrow">{d.retreat.title}</p>
        <h1>Send an anonymous note</h1>
        <div className="panel-sage stack">
          <p style={{ margin: 0 }}>
            This note goes to {d.retreat.organiserName || d.org.name} separately from any review. It is stored without your name, email, invitation
            link or response, and organisers see only the week it arrived.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Please be aware:</strong> details you write in the note itself (a room number, a specific conversation) may still make it clear who
            wrote it. We can’t promise complete anonymity, but we don’t connect this note to you.
          </p>
          <a href={`/o/${orgSlug}/privacy?programme=${retreatSlug}`} target="_blank" rel="noopener noreferrer">
            Read the privacy notice
          </a>
        </div>

        {state === 'sent' ? (
          <div className="card" role="status" style={{ marginTop: '1.5rem' }}>
            <h2>Note sent</h2>
            <p>Thank you. You can close this page.</p>
            <button className="btn secondary" onClick={() => setState('idle')}>
              Write another note
            </button>
          </div>
        ) : !d.open ? (
          <div className="notice" style={{ marginTop: '1.5rem' }}>
            Notes for this retreat are closed.
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: '1.5rem' }} noValidate>
            {error && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{error}</div>}
            <Field id="note" label="Your note" hint="Up to 4,000 characters.">
              <textarea id="note" value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} aria-describedby="note-hint" style={{ minHeight: '12rem' }} />
            </Field>
            <Field id="cat" label="Topic (optional)">
              <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send anonymously'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
