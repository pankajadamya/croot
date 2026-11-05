import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { REVIEW_KINDS, type ReviewKind } from '../../shared/categories'
import { ApiError } from '../lib/api'
import { Field } from './Controls'

export interface OrganiserDetails {
  contactName: string
  phone: string
  orgName: string
  websiteUrl: string
  country: string
  reviewKinds: ReviewKind[]
  volume: string
  message: string
}

/**
 * The basic details asked of everyone before they get organiser access, whether they request it or
 * accept an invite. The server validates the same fields (server/src/lib/organisers.ts).
 */
export function OrganiserDetailsForm({
  initial,
  email,
  orgNameLabel = 'Organisation or business name',
  orgNameHint,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<OrganiserDetails>
  email: string
  orgNameLabel?: string
  orgNameHint?: string
  submitLabel: string
  onSubmit: (details: OrganiserDetails & { acceptTerms: true }) => Promise<void>
}) {
  const [d, setD] = useState<OrganiserDetails>({
    contactName: '',
    phone: '',
    orgName: '',
    websiteUrl: '',
    country: '',
    reviewKinds: [],
    volume: '',
    message: '',
    ...initial,
  })
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({})

  const set = (k: keyof OrganiserDetails) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  const toggleKind = (k: ReviewKind) => setD({ ...d, reviewKinds: d.reviewKinds.includes(k) ? d.reviewKinds.filter((x) => x !== k) : [...d.reviewKinds, k] })
  const err = (k: string) => fieldErrors[k]?.[0]

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    if (!accepted) {
      setFieldErrors({ acceptTerms: ['Please accept the data processing terms'] })
      return
    }
    setBusy(true)
    try {
      await onSubmit({ ...d, acceptTerms: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
      if (e instanceof ApiError && e.details) setFieldErrors(e.details)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      <div className="grid-2">
        <Field id="od-name" label="Your full name" error={err('contactName')}>
          <input id="od-name" type="text" autoComplete="name" value={d.contactName} onChange={set('contactName')} aria-invalid={Boolean(err('contactName'))} />
        </Field>
        <Field id="od-email" label="Email" hint="The address you’re signed in with.">
          <input id="od-email" type="email" value={email} readOnly aria-readonly="true" />
        </Field>
        <Field id="od-phone" label="Phone (optional)" error={err('phone')}>
          <input id="od-phone" type="tel" autoComplete="tel" value={d.phone} onChange={set('phone')} aria-invalid={Boolean(err('phone'))} />
        </Field>
        <Field id="od-country" label="Country (optional)">
          <input id="od-country" type="text" autoComplete="country-name" value={d.country} onChange={set('country')} />
        </Field>
      </div>
      <Field id="od-org" label={orgNameLabel} hint={orgNameHint} error={err('orgName')}>
        <input id="od-org" type="text" autoComplete="organization" value={d.orgName} onChange={set('orgName')} aria-invalid={Boolean(err('orgName'))} />
      </Field>
      <Field id="od-web" label="Website (optional)" error={err('websiteUrl')}>
        <input id="od-web" type="url" placeholder="https://" value={d.websiteUrl} onChange={set('websiteUrl')} aria-invalid={Boolean(err('websiteUrl'))} />
      </Field>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
        <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>What will you collect reviews for?</legend>
        <div className="kind-choices">
          {(Object.keys(REVIEW_KINDS) as ReviewKind[]).map((k) => (
            <label key={k} className={`kind-choice ${d.reviewKinds.includes(k) ? 'selected' : ''}`}>
              <input type="checkbox" checked={d.reviewKinds.includes(k)} onChange={() => toggleKind(k)} />
              <span>
                <strong>{REVIEW_KINDS[k].label}</strong>
                <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>
                  {REVIEW_KINDS[k].description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {err('reviewKinds') && <span className="error">{err('reviewKinds')}</span>}
      </fieldset>
      <Field id="od-volume" label="Roughly how many retreats or guests a year? (optional)">
        <input id="od-volume" type="text" placeholder="e.g. 4 retreats, about 60 guests" value={d.volume} onChange={set('volume')} />
      </Field>
      <Field id="od-message" label="Anything else we should know? (optional)">
        <textarea id="od-message" value={d.message} onChange={set('message')} style={{ minHeight: '5rem' }} />
      </Field>
      <div className="field">
        <label className="kind-choice" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} aria-invalid={Boolean(err('acceptTerms'))} />
          <span>
            I accept the{' '}
            <Link to="/legal/terms" target="_blank">
              data processing terms
            </Link>{' '}
            that apply to my guests’ data, and I’ve read the{' '}
            <Link to="/legal/privacy" target="_blank">
              privacy notice
            </Link>
            .
          </span>
        </label>
        {err('acceptTerms') && <span className="error">{err('acceptTerms')}</span>}
      </div>
      <button className="btn" disabled={busy}>
        {busy ? 'Sending…' : submitLabel}
      </button>
    </form>
  )
}
