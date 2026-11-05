import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

interface FormProps {
  orgSlug: string
  orgName: string
  retreatSlug?: string
  /** Called by Cancel (and after sending, in the pop-up). */
  onCancel?: () => void
  autoFocus?: boolean
}

/**
 * The sign-up form itself. Double opt-in: the visitor gets an email to confirm before anything else is
 * sent. No cookies; the request carries no session.
 */
function InterestForm({ orgSlug, orgName, retreatSlug, onCancel, autoFocus }: FormProps) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [wording, setWording] = useState(`Email me about future retreats from ${orgName}. I can unsubscribe at any time.`)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    fetch(`/api/public/orgs/${orgSlug}/interest`, { credentials: 'omit' })
      .then((r) => r.json())
      .then((d: { wording?: string }) => d.wording && setWording(d.wording))
      .catch(() => {})
  }, [orgSlug])

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

  if (state === 'sent') {
    return (
      <div className="interest-form">
        <p className="notice ok" role="status" style={{ margin: 0 }}>
          Nearly there: check your inbox for an email from us and confirm. Nothing more is sent until you do.
        </p>
        {onCancel && (
          <div className="row">
            <button type="button" className="btn secondary" onClick={onCancel}>
              Done
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <form className="interest-form" onSubmit={submit} noValidate>
      <div className="interest-fields">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" autoComplete="email" required autoFocus={autoFocus} value={email} onChange={(e) => setEmail(e.target.value)} />
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
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        We’ll email you once to confirm. Your email is used only for {orgName}’s retreat news and is deleted when you unsubscribe.
      </p>
    </form>
  )
}

/** "Hear about the next retreat" as a card on the page: a button that opens the form in place. */
export function InterestSignup({ orgSlug, orgName, retreatSlug }: { orgSlug: string; orgName: string; retreatSlug?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section className="interest card" aria-labelledby={`${id}-title`}>
      <div className="interest-head">
        <div>
          <h2 id={`${id}-title`}>Hear about the next retreat</h2>
          <p className="muted">Leave your email and {orgName} will let you know when the next one opens.</p>
        </div>
        {!open && (
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            Notify me
          </button>
        )}
      </div>
      {open && <InterestForm orgSlug={orgSlug} orgName={orgName} retreatSlug={retreatSlug} onCancel={() => setOpen(false)} autoFocus />}
    </section>
  )
}

/**
 * The same sign-up in a pop-up (a native modal dialog: focus stays inside, Esc closes it, and focus
 * goes back to the button that opened it).
 */
export function InterestDialog({ open, onClose, orgSlug, orgName, retreatSlug }: { open: boolean; onClose: () => void; orgSlug: string; orgName: string; retreatSlug?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="interest-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()} // a click on the backdrop closes it
    >
      {open && (
        <div className="interest-dialog-body">
          <button type="button" className="interest-dialog-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <h2 id={`${id}-title`}>Hear about the next retreat</h2>
          <p className="muted">Leave your email and {orgName} will let you know when the next one opens.</p>
          <InterestForm orgSlug={orgSlug} orgName={orgName} retreatSlug={retreatSlug} onCancel={onClose} autoFocus />
        </div>
      )}
    </dialog>
  )
}
