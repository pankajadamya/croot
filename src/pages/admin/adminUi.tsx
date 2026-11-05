import { useEffect, useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, get, orgApi } from '../../lib/api'
import { formatRange } from '../../lib/format'
import { REVIEW_KINDS, type ReviewKind } from '../../../shared/categories'
import type { InviteState, OrgSummary, PublicationStatus, ResponseStatus, Retreat } from './types'

/** First server-side field error for `key`, from a 400 response's `details`. */
export function fieldError(error: unknown, key: string): string | undefined {
  if (!(error instanceof ApiError) || !error.details) return undefined
  const v = (error.details as Record<string, unknown>)[key]
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined
}

/** Shows a mutation/query error as a notice, plus any field errors not already shown inline. */
export function MutationError({ error, shownFields = [] }: { error: unknown; shownFields?: string[] }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  const extra: string[] = []
  if (error instanceof ApiError && error.details) {
    for (const [key, value] of Object.entries(error.details)) {
      if (shownFields.includes(key) || !Array.isArray(value)) continue
      for (const v of value) if (typeof v === 'string') extra.push(key === 'tokens' || key === 'formErrors' ? v : `${key}: ${v}`)
    }
  }
  return (
    <div className="notice error" role="alert">
      {message}
      {extra.length > 0 && (
        <ul className="small" style={{ margin: '0.5rem 0 0' }}>
          {extra.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className = 'btn secondary small' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
        } catch {
          window.prompt('Copy this text', text)
        }
      }}
    >
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  )
}

/** A read-only URL with a copy button. */
export function CopyField({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint">{hint}</span>}
      <div className="copy-row">
        <input id={id} type="text" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={value} />
      </div>
    </div>
  )
}

/** A link that cannot be retrieved again (setup links, invitation links). */
export function OneTimeLinkNotice({ title, url, onDismiss }: { title: string; url: string; onDismiss?: () => void }) {
  return (
    <div className="notice warn" role="status">
      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{title}</p>
      <p className="small" style={{ margin: '0 0 0.75rem' }}>
        Copy this link now and share it privately. For security it is stored only in scrambled form, so it cannot be shown again — if it is lost, issue a new one.
      </p>
      <CopyField label="One-time link" value={url} />
      {onDismiss && (
        <button type="button" className="btn secondary small" onClick={onDismiss}>
          I’ve copied it
        </button>
      )}
    </div>
  )
}

const INVITE_STATES: Record<InviteState, [string, 'ok' | 'warn' | 'danger' | 'neutral']> = {
  not_invited: ['No link yet', 'neutral'],
  sent: ['Link issued', 'neutral'],
  opened: ['Opened', 'neutral'],
  draft: ['Draft in progress', 'warn'],
  submitted: ['Submitted (private)', 'ok'],
  changes_requested: ['Changes requested', 'warn'],
  consented: ['Submitted · story consented', 'ok'],
  published: ['Published', 'ok'],
  withdrawn: ['Withdrawn', 'danger'],
  revoked: ['Link revoked', 'danger'],
  expired: ['Link expired', 'warn'],
}

export function InviteStateBadge({ state }: { state: InviteState }) {
  const [label, tone] = INVITE_STATES[state]
  return <span className={`badge ${tone}`}>{label}</span>
}

const PUBLICATION: Record<PublicationStatus, [string, 'ok' | 'warn' | 'danger' | 'neutral']> = {
  none: ['Not published', 'neutral'],
  published: ['Published', 'ok'],
  unpublished: ['Unpublished', 'warn'],
  withdrawn: ['Withdrawn by guest', 'danger'],
}

export function PublicationBadge({ status }: { status: PublicationStatus }) {
  const [label, tone] = PUBLICATION[status]
  return <span className={`badge ${tone}`}>{label}</span>
}

const RESPONSE: Record<ResponseStatus, [string, 'ok' | 'warn' | 'danger' | 'neutral']> = {
  submitted: ['Submitted', 'ok'],
  changes_requested: ['With guest for changes', 'warn'],
  withdrawn: ['Withdrawn', 'danger'],
}

export function ResponseStatusBadge({ status }: { status: ResponseStatus }) {
  const [label, tone] = RESPONSE[status]
  return <span className={`badge ${tone}`}>{label}</span>
}

export const RETREAT_STATUS_LABELS: Record<Retreat['status'], string> = {
  draft: 'Draft',
  collecting: 'Collecting responses',
  closed: 'Closed',
  archived: 'Archived',
}

export function YesNo({ value }: { value: boolean }) {
  return <span className={`badge ${value ? 'ok' : 'neutral'}`}>{value ? 'Yes' : 'No'}</span>
}

// ---------------------------------------------------------------------------------------------
// Queries shared across admin pages

export const orgKey = (orgSlug: string) => ['admin', orgSlug, 'summary'] as const
export const retreatKey = (orgSlug: string, retreatId: string) => ['admin', orgSlug, 'retreat', retreatId] as const

export function useOrgSummary(orgSlug: string) {
  return useQuery({ queryKey: orgKey(orgSlug), queryFn: () => get<OrgSummary>(orgApi(orgSlug)) })
}

export function useRetreat(orgSlug: string, retreatId: string) {
  return useQuery({
    queryKey: retreatKey(orgSlug, retreatId),
    queryFn: () => get<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats/${retreatId}`).then((r) => r.retreat),
  })
}

// ---------------------------------------------------------------------------------------------
// Date helpers for <input type="datetime-local">, in the organiser's own time zone.

export function toLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

/** Date range for a programme; property programmes may have no dates. */
export function programmeDates(start: string | null | undefined, end: string | null | undefined): string {
  return start && end ? formatRange(start, end) : ''
}

export function KindBadge({ kind }: { kind: ReviewKind }) {
  return <span className="badge neutral">{REVIEW_KINDS[kind].label}</span>
}

export function publicRetreatUrl(orgSlug: string, retreatSlug: string) {
  return `${window.location.origin}/o/${orgSlug}/r/${retreatSlug}`
}
