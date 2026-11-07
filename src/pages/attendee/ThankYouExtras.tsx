import { useEffect, useRef, useState, type ReactNode } from 'react'
import { get, post } from '../../lib/api'
import { useAuth, type Session } from '../../lib/auth'

/**
 * After sending a review: "Make your review count". A one-time code to the guest's address marks the
 * review "Verified email" and signs them in, so they can manage it later from My reviews. An address on
 * file is shown masked (a forwarded link doesn't reveal it); one the guest types is shown in full, and
 * they can correct a typo. A new code is a minute apart; a code works for 10 minutes. Skipping it is fine:
 * the review is posted either way.
 */
function VerifySteps({
  base,
  maskedEmail,
  onDone,
  onSkip,
  afterDone,
}: {
  base: string
  /** The address on file, masked; null when the guest gives one here (joined by group link). */
  maskedEmail: string | null
  onDone: (movedTo?: string) => void
  onSkip?: () => void
  afterDone?: ReactNode
}) {
  const [movedTo, setMovedTo] = useState<string | undefined>()
  const { setSession } = useAuth()
  const [stage, setStage] = useState<'start' | 'sent' | 'done'>('start')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(maskedEmail)
  const needsEmail = !maskedEmail
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A new code can be asked for a minute after the last (the server holds the same line); codes work
  // for 10 minutes. Both come back from the server with each send.
  const [validMinutes, setValidMinutes] = useState(10)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (resendAt <= now) return
    const id = window.setTimeout(() => setNow(Date.now()), 1000)
    return () => window.clearTimeout(id)
  }, [resendAt, now])
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ sentTo: string; validMinutes?: number; resendSeconds?: number }>(`${base}/verify/send`, needsEmail ? { email } : undefined)
      setSentTo(r.sentTo)
      if (r.validMinutes) setValidMinutes(r.validMinutes)
      setResendAt(Date.now() + (r.resendSeconds ?? 60) * 1000)
      setNow(Date.now())
      setCode('')
      setStage('sent')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const r = await post<Session & { movedTo?: string }>(`${base}/verify/confirm`, needsEmail ? { code, email } : { code })
      setSession(r)
      setMovedTo(r.movedTo)
      setStage('done')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'done') {
    return (
      <div role="status">
        <h2 id="verify-title">
          <span aria-hidden="true">✓</span> Thank you, it’s confirmed
        </h2>
        <p>
          Your review shows as <strong>Verified email</strong>, and you’re signed in, so you can find it any time under My reviews.
        </p>
        {afterDone}
        <div className="row" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn" onClick={() => onDone(movedTo)}>
            Done
          </button>
        </div>
      </div>
    )
  }
  return (
    <>
      <h2 id="verify-title">Make your review count</h2>
      {needsEmail && stage === 'start' ? (
        <p>
          Reviews from guests who confirm their email show as <strong>✓ Verified email</strong>, so future guests know they’re genuine. Add your
          email and we’ll send a 6-digit code. You’ll also be able to come back and change your review, and the organiser will see the address
          with your review.
        </p>
      ) : stage === 'sent' ? (
        <p>
          We’ve emailed a 6-digit code to <strong>{sentTo}</strong>. It works for {validMinutes} minutes.
        </p>
      ) : (
        <p>
          Reviews from guests who confirm their email show as <strong>✓ Verified email</strong>, so future guests know they’re genuine. It takes a
          moment: we’ll email a 6-digit code to <strong>{sentTo}</strong>.
        </p>
      )}
      {stage === 'start' ? (
        <div className="stack" style={{ gap: '0.6rem' }}>
          {needsEmail && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="verify-email">Your email</label>
              <input id="verify-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
          )}
          <div className="row" style={{ gap: '0.6rem' }}>
            <button type="button" className="btn" onClick={() => void send()} disabled={busy || (needsEmail && !email.includes('@')) || waitSeconds > 0}>
              {busy ? 'Sending…' : waitSeconds > 0 ? `Email me a code (in ${waitSeconds}s)` : 'Email me a code'}
            </button>
            {onSkip && (
              <button type="button" className="btn ghost" onClick={onSkip}>
                Not now
              </button>
            )}
          </div>
        </div>
      ) : (
        <form
          className="verify-code-form"
          onSubmit={(e) => {
            e.preventDefault()
            void confirm()
          }}
        >
          <label htmlFor="verify-code">Code from the email</label>
          <div className="row" style={{ gap: '0.5rem' }}>
            <input
              id="verify-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <button type="submit" className="btn" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Confirm'}
            </button>
          </div>
          <div className="row" style={{ gap: '0.8rem' }}>
            <button type="button" className="link-button small" onClick={() => void send()} disabled={busy || waitSeconds > 0}>
              {waitSeconds > 0 ? `Send a new code in ${waitSeconds}s` : 'Send a new code'}
            </button>
            {needsEmail && (
              // A typo in the address: back to the address, keeping what they typed to correct it.
              <button
                type="button"
                className="link-button small"
                onClick={() => {
                  setStage('start')
                  setError(null)
                }}
              >
                Change email
              </button>
            )}
            {onSkip && (
              <button type="button" className="link-button small" onClick={onSkip}>
                Not now
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <p className="small muted" style={{ margin: '0.8rem 0 0' }}>
        Optional: your review is posted either way. We use your email only to confirm and manage your review: no marketing without your consent,
        and it’s never shared with anyone else.
      </p>
    </>
  )
}

/**
 * The verification step as a pop-up that opens by itself on the thank-you page (people overlook a card),
 * once per visit. "Not now" closes it and leaves a reminder line on the page that reopens it. After
 * confirming, it offers sharing, and the page refreshes when it closes.
 */
export function VerifyPrompt({ base, maskedEmail, onVerified, share }: { base: string; maskedEmail: string | null; onVerified: () => void; share: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const key = `verify-dismissed:${base}`
  const [open, setOpen] = useState(() => {
    try {
      return window.sessionStorage.getItem(key) !== '1'
    } catch {
      return true
    }
  })
  const [verified, setVerified] = useState(false)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal?.()
    if (!open && d.open) d.close()
  }, [open])
  function skip() {
    try {
      window.sessionStorage.setItem(key, '1')
    } catch {
      /* private mode: it just asks again next time */
    }
    setOpen(false)
  }
  function done(movedTo?: string) {
    setOpen(false)
    setVerified(true)
    // Matched to their place on the guest list: their review now lives there (and they're signed in).
    if (movedTo) window.location.assign(movedTo)
    else onVerified()
  }
  return (
    <>
      {!open && !verified && (
        <p className="verify-reminder" role="status">
          Your review isn’t verified yet.{' '}
          <button type="button" className="link-button" onClick={() => setOpen(true)}>
            Confirm your email
          </button>{' '}
          so it shows as <strong>✓ Verified email</strong>.
        </p>
      )}
      <dialog
        ref={ref}
        className="confirm-dialog verify-dialog"
        aria-labelledby="verify-title"
        onCancel={(e) => {
          e.preventDefault()
          skip()
        }}
      >
        {open && (
          <div className="confirm-dialog-body">
            <VerifySteps base={base} maskedEmail={maskedEmail} onDone={done} onSkip={skip} afterDone={share} />
          </div>
        )}
      </dialog>
    </>
  )
}

/**
 * "Share your journey with friends and family": the phone's own sharing (WhatsApp, Messages, the guest's
 * own email…), WhatsApp, or a copied link. Croot sends nothing itself, so no one is emailed who didn't ask.
 * compact: one row (the top of the thank-you page); otherwise with a heading (after verifying).
 */
export function ShareJourney({
  title,
  organiser,
  pagePath,
  storyPath,
  compact = false,
}: {
  title: string
  organiser: string
  pagePath: string | null
  storyPath: string | null
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const path = storyPath ?? pagePath
  if (!path) return null
  const url = new URL(path, window.location.origin).toString()
  const text = storyPath ? `I shared my story from ${title} with ${organiser}. Have a look:` : `I’ve just been on ${title} with ${organiser}. Have a look:`
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const buttons = (
    <div className="row" style={{ gap: '0.5rem' }}>
      {canShare && (
        <button type="button" className="btn secondary small" onClick={() => void navigator.share({ title, text, url }).catch(() => {})}>
          Share…
        </button>
      )}
      <a className="btn secondary small" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">
        WhatsApp ↗
      </a>
      <button
        type="button"
        className="btn ghost small"
        onClick={() =>
          void navigator.clipboard?.writeText(url).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  )
  if (compact) {
    return (
      <div className="share-journey is-compact" aria-label="Share your journey">
        <span className="small muted">Share your journey with friends and family:</span>
        {buttons}
      </div>
    )
  }
  return (
    <section className="share-journey" aria-labelledby="share-title">
      <h3 id="share-title">Share your journey</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Send {storyPath ? 'your published story' : 'the retreat page'} to friends and family.
      </p>
      {buttons}
    </section>
  )
}

type InterestView = { orgName: string; wording: string; maskedEmail: string | null; needsEmail: boolean; instant: boolean; status: 'subscribed' | 'pending' | null }

/**
 * "Hear about the next retreat" after sending a review. The guest's address is already known, so it
 * isn't asked for again: a proven address joins in one tap; one only the organiser entered gets a
 * confirmation email first (lib/guestInterest.ts on the server). A guest with no address types one.
 * `refresh` changes when the guest confirms their email, which can make the sign-up one tap.
 */
export function GuestInterest({ base, refresh }: { base: string; refresh?: unknown }) {
  const [view, setView] = useState<InterestView | null>(null)
  const [agree, setAgree] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    get<InterestView>(`${base}/interest`).then((v) => live && setView(v), () => undefined)
    return () => {
      live = false
    }
  }, [base, refresh])
  if (!view) return null

  async function signUp() {
    setError(null)
    if (!agree) return setError('Please tick the box so we can email you.')
    setBusy(true)
    try {
      const r = await post<{ status: 'subscribed' | 'pending'; sentTo?: string }>(`${base}/interest`, view!.needsEmail ? { consent: true, email } : { consent: true })
      setSentTo(r.sentTo ?? null)
      setView({ ...view!, status: r.status })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card guest-interest" aria-labelledby="guest-interest-title">
      <h2 id="guest-interest-title" style={{ marginTop: 0, fontSize: '1.2rem' }}>
        Hear about the next retreat
      </h2>
      {view.status === 'subscribed' ? (
        <p className="notice ok small" role="status" style={{ margin: 0 }}>
          <span aria-hidden="true">✓</span> You’re on the list. {view.orgName} will let you know when the next one opens.
        </p>
      ) : view.status === 'pending' ? (
        <p className="notice small" role="status" style={{ margin: 0 }}>
          Nearly there: we’ve emailed {sentTo ? <strong>{sentTo}</strong> : 'you'} a link to confirm. Nothing more is sent until you do.
        </p>
      ) : (
        <div className="stack" style={{ gap: '0.6rem' }}>
          <p className="muted" style={{ margin: 0 }}>
            {view.maskedEmail ? (
              <>
                {view.orgName} will email <strong>{view.maskedEmail}</strong> when the next retreat opens.
                {!view.instant && ' We’ll send one email first so you can confirm.'}
              </>
            ) : (
              <>Leave your email and {view.orgName} will let you know when the next one opens.</>
            )}
          </p>
          {view.needsEmail && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="guest-interest-email">Your email</label>
              <input id="guest-interest-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          <label className="interest-consent">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{view.wording}</span>
          </label>
          {error && (
            <p className="error small" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => void signUp()} disabled={busy || (view.needsEmail && !email.includes('@'))}>
              {busy ? 'Saving…' : 'Notify me'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
