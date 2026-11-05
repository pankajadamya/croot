import { useEffect, useId, useState, type FormEvent } from 'react'

/**
 * "Tell me about the next retreat": a button that opens a small form. Double opt-in: the visitor gets
 * an email to confirm before anything else is sent. No cookies; the request carries no session.
 */
export function InterestSignup({ orgSlug, orgName, retreatSlug, variant = 'card' }: { orgSlug: string; orgName: string; retreatSlug?: string; variant?: 'card' | 'inline' }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [wording, setWording] = useState(`Email me about future retreats from ${orgName}. I can unsubscribe at any time.`)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    fetch(`/api/public/orgs/${orgSlug}/interest`, { credentials: 'omit' })
      .then((r) => r.json())
      .then((d: { wording?: string }) => d.wording && setWording(d.wording))
      .catch(() => {})
  }, [open, orgSlug])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!agree) return setError('Please tick the box so we can email you.')
    setState('sending')
    try {
      const res = await fetch(`/api/public/orgs/${orgSlug}/interest`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, retreatSlug, consent: true }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Something went wrong. Please try again.')
      }
      setState('sent')
    } catch (err) {
      setState('idle')
      setError((err as Error).message)
    }
  }

  return (
    <section className={`interest ${variant}`} aria-labelledby={`${id}-title`}>
      <div className="interest-head">
        <div>
          <h2 id={`${id}-title`}>Hear about the next retreat</h2>
          <p className="muted">Leave your email and {orgName} will let you know when the next one opens.</p>
        </div>
        {!open && state !== 'sent' && (
          <button type="button" className="btn" onClick={() => setOpen(true)} aria-expanded={false}>
            Notify me
          </button>
        )}
      </div>
      {state === 'sent' ? (
        <p className="notice ok" role="status">
          Nearly there: check your inbox for an email from us and confirm. Nothing more is sent until you do.
        </p>
      ) : (
        open && (
          <form className="interest-form" onSubmit={submit} noValidate>
            <div className="interest-fields">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`${id}-email`}>Email</label>
                <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`${id}-name`}>First name (optional)</label>
                <input id={`${id}-name`} type="text" autoComplete="given-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <label className="interest-consent">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{wording}</span>
            </label>
            {error && (
              <p className="error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            <div className="row">
              <button className="btn" type="submit" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Keep me posted'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              We’ll email you once to confirm. Your email is used only for {orgName}’s retreat news and is deleted when you unsubscribe.
            </p>
          </form>
        )
      )}
    </section>
  )
}
