import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, orgApi, post } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { useConfirm } from '../../../components/ConfirmDialog'
import { CopyButton, MutationError } from '../adminUi'
import type { Retreat } from '../types'

/**
 * The group link: one link to share with the whole group (say, in the retreat's WhatsApp group).
 * Joining needs only a name (confirming an email comes later, optionally, on the thank-you page). It
 * lasts as long as the organiser chooses, from 1 hour to 7 days, for up to 20 people, and someone not
 * on the guest list needs confirming here before their review can be published. Making one asks the
 * organiser to acknowledge that reviews must be genuine, and emails the owners the same.
 */

/** How long a new group link works: 1 hour to 7 days. */
const LIFETIMES = [
  { hours: 1, label: '1 hour' },
  { hours: 3, label: '3 hours' },
  { hours: 6, label: '6 hours' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '1 day' },
  { hours: 48, label: '2 days' },
  { hours: 72, label: '3 days' },
  { hours: 120, label: '5 days' },
  { hours: 168, label: '7 days' },
]
export function GroupLinkCard({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}/group-link`
  const key = ['admin', orgSlug, 'group-link', retreat.id]
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const status = useQuery({ queryKey: key, queryFn: () => get<{ active: boolean; createdAt: string | null; expiresAt: string | null; joined: number; joinedOnLink: number; maxJoins: number }>(base) })
  const [ack, setAck] = useState(false)
  const [hours, setHours] = useState(168)
  const [url, setUrl] = useState<string | null>(null)
  const make = useMutation({
    mutationFn: () => post<{ url: string }>(base, { acknowledge: true, hours }),
    onSuccess: (r) => {
      setUrl(r.url)
      setAck(false)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const stop = useMutation({
    mutationFn: () => del(base),
    onSuccess: () => {
      setUrl(null)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const s = status.data
  const collecting = retreat.status === 'collecting'
  const message = url ? `Thank you for being part of ${retreat.title}! We’d love to hear how it was. Share your review here (it takes a few minutes): ${url}` : ''

  return (
    <section className="card group-link-card" aria-labelledby="group-link-title">
      <h2 id="group-link-title" style={{ marginTop: 0 }}>
        Group link
      </h2>
      <p className="small muted">
        One link for the whole group, for example in your retreat’s WhatsApp group. Each person gives their name and writes their own review; on
        the thank-you page they’re asked to confirm their email (optional), like every guest. It works for as long as you choose (up to 7 days)
        and for up to 20 people. Personal links stay the safer choice: use this when you can’t send them one by one.
      </p>
      {s?.active && !url && (
        <p className="small">
          A group link is active until {formatDateTime(s.expiresAt!)}: {s.joinedOnLink} of {s.maxJoins} people have joined through it. For
          safety it can’t be shown again: make a new one to share it again (the old one stops working).
        </p>
      )}
      {url && (
        <div className="stack" style={{ gap: '0.5rem' }}>
          <p className="small" role="status" style={{ margin: 0 }}>
            Your group link (shown once):
          </p>
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
            <label className="sr-only" htmlFor="group-link-url">
              Group link
            </label>
            <input id="group-link-url" type="text" readOnly value={url} className="mono-input" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={url} />
          </div>
          <div className="row" style={{ gap: '0.4rem' }}>
            <a className="btn secondary small" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
              Send to a WhatsApp group ↗
            </a>
          </div>
        </div>
      )}
      <div className="notice warn small" style={{ marginTop: '0.8rem' }}>
        <strong>Reviews must be genuine.</strong> Share the link only with people who were there. Croot checks reviews for warning signs, and
        organisations found posting or encouraging reviews that aren’t genuine can be suspended or removed, and their reviews taken down. People
        not on your guest list appear as “Joined by group link” and need confirming before their review can be published.
      </div>
      <label className="row small" style={{ gap: '0.5rem', marginTop: '0.8rem', alignItems: 'flex-start', fontWeight: 400 }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: '0.2rem' }} />
        <span>I’ll share it only with people who attended, and I understand my organisation can be suspended if reviews aren’t genuine.</span>
      </label>
      <div className="row" style={{ gap: '0.5rem', marginTop: '0.6rem', alignItems: 'center' }}>
        <label className="small" htmlFor="group-link-hours" style={{ fontWeight: 600 }}>
          Link works for
        </label>
        <select id="group-link-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ width: 'auto' }}>
          {LIFETIMES.map((l) => (
            <option key={l.hours} value={l.hours}>
              {l.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn secondary" disabled={!ack || !collecting || make.isPending} onClick={() => make.mutate()}>
          {make.isPending ? 'Making…' : s?.active ? 'Make a new group link' : 'Make a group link'}
        </button>
        {s?.active && (
          <button
            type="button"
            className="btn ghost"
            disabled={stop.isPending}
            onClick={() =>
              void confirm({ title: 'Stop the group link?', message: 'It stops working straight away. Reviews already written are kept.', confirmLabel: 'Stop link', danger: true }).then(
                (ok) => ok && stop.mutate(),
              )
            }
          >
            Stop the link
          </button>
        )}
      </div>
      {!collecting && <p className="small muted">Start collecting reviews first, so the link works.</p>}
      <p className="small muted" style={{ margin: '0.6rem 0 0' }}>
        Your organisation’s owners are emailed whenever a group link is made.
      </p>
      <MutationError error={make.error || stop.error} />
    </section>
  )
}
