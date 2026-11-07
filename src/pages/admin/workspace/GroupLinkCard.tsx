import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, orgApi, post } from '../../../lib/api'
import { formatDate } from '../../../lib/format'
import { useConfirm } from '../../../components/ConfirmDialog'
import { CopyButton, MutationError } from '../adminUi'
import type { Retreat } from '../types'

/**
 * The group link: one link to share with the whole group (say, in the retreat's WhatsApp group).
 * Anyone it reaches must confirm their email with a code before they can write, and someone not on
 * the guest list needs confirming here before their review can be published. Making one asks the
 * organiser to acknowledge that reviews must be genuine, and emails the owners the same.
 */
export function GroupLinkCard({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}/group-link`
  const key = ['admin', orgSlug, 'group-link', retreat.id]
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const status = useQuery({ queryKey: key, queryFn: () => get<{ active: boolean; createdAt: string | null; expiresAt: string | null; joined: number }>(base) })
  const [ack, setAck] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const make = useMutation({
    mutationFn: () => post<{ url: string }>(base, { acknowledge: true }),
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
  const message = url ? `Thank you for being part of ${retreat.title}! We’d love to hear how it was. Share your review here (you’ll confirm your email first): ${url}` : ''

  return (
    <section className="card group-link-card" aria-labelledby="group-link-title">
      <h2 id="group-link-title" style={{ marginTop: 0 }}>
        Group link
      </h2>
      <p className="small muted">
        One link for the whole group, for example in your retreat’s WhatsApp group. Each person confirms their email with a code, then writes their
        own review. Personal links stay the safer choice: use this when you can’t send them one by one.
      </p>
      {s?.active && !url && (
        <p className="small">
          A group link is active until {formatDate(s.expiresAt!)}. {s.joined ? `${s.joined} joined through it.` : 'No one has joined through it yet.'} For
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
      <div className="row" style={{ gap: '0.5rem', marginTop: '0.6rem' }}>
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
