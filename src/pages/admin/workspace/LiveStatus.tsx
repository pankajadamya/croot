import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { get, orgApi, patch } from '../../../lib/api'
import { CopyField, MutationError, orgKey, publicRetreatUrl, retreatKey, useOrgSummary } from '../adminUi'
import type { ContentRevision, Retreat } from '../types'

/**
 * One place that answers "is my page live, and can guests use their links?", shown above every tab.
 * Draft is the state that silently breaks things (guest links say "not found" and the public page is
 * hidden), so it gets a one-click way out.
 */
export function LiveStatus({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const queryClient = useQueryClient()
  const content = useQuery({
    queryKey: ['admin', orgSlug, 'content', retreat.id],
    queryFn: () => get<{ draft: ContentRevision | null; published: ContentRevision | null }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/content`),
  })
  const summary = useOrgSummary(orgSlug)
  const stats = summary.data?.retreats.find((r) => r.id === retreat.id)?.stats
  const start = useMutation({
    mutationFn: () => patch<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats/${retreat.id}`, { status: 'collecting' }),
    onSuccess: ({ retreat: updated }) => {
      queryClient.setQueryData(retreatKey(orgSlug, retreat.id), updated)
      void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
    },
  })

  const base = `/admin/${orgSlug}/retreats/${retreat.id}`
  const pageLive = retreat.status === 'collecting' || retreat.status === 'closed'
  const openingLive = Boolean(content.data?.published)
  const published = stats?.published ?? 0
  const url = publicRetreatUrl(orgSlug, retreat.slug)

  const checks: Array<{ ok: boolean; label: string; action?: { to: string; text: string } }> = [
    {
      ok: retreat.status === 'collecting',
      label:
        retreat.status === 'collecting'
          ? 'Collecting reviews: guest links work'
          : retreat.status === 'draft'
            ? 'Draft: guest links won’t open yet'
            : retreat.status === 'closed'
              ? 'Closed: guests can no longer send reviews'
              : 'Archived: hidden everywhere',
    },
    { ok: openingLive, label: openingLive ? 'Your opening is published' : 'Your opening isn’t published yet', action: openingLive ? undefined : { to: `${base}/site`, text: 'Write and publish it' } },
    {
      ok: published > 0,
      label: published > 0 ? `${published} guest stor${published === 1 ? 'y' : 'ies'} on the page` : 'No guest stories published yet',
      action: published > 0 ? undefined : { to: `${base}/responses`, text: 'Review responses' },
    },
  ]

  return (
    <section className={`live-status ${retreat.status === 'draft' ? 'is-draft' : ''}`} aria-labelledby="live-status-title">
      <div className="live-status-head">
        <div>
          <h2 id="live-status-title">
            Public page: <span className={`badge ${pageLive ? 'ok' : 'warn'}`}>{pageLive ? 'Live' : 'Not live'}</span>
          </h2>
          {!pageLive && (
            <p className="small" style={{ margin: '0.25rem 0 0' }}>
              {retreat.status === 'draft'
                ? 'This programme is a draft, so its public page is hidden and guest links show “not found”.'
                : 'Archived programmes are hidden from the public and guests.'}
            </p>
          )}
        </div>
        <div className="row">
          {retreat.status === 'draft' && (
            <button type="button" className="btn" disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? 'Starting…' : 'Start collecting reviews'}
            </button>
          )}
          {pageLive && (
            <a className="btn secondary" href={url} target="_blank" rel="noopener noreferrer">
              Open public page ↗
            </a>
          )}
        </div>
      </div>
      <ul className="live-checks">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'ok' : 'todo'}>
            <span aria-hidden="true">{c.ok ? '✓' : '○'}</span>
            <span>
              {c.label}
              {c.action && (
                <>
                  {' · '}
                  <Link to={c.action.to}>{c.action.text}</Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {pageLive && (
        <details className="live-link">
          <summary>Public page link</summary>
          <CopyField label="Public review page" value={url} hint="Shows your opening, practical details and published guest stories." />
        </details>
      )}
      <MutationError error={start.error} />
    </section>
  )
}
