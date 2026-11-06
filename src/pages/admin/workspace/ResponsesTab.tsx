import { useEffect, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { get, orgApi } from '../../../lib/api'
import { formatDate } from '../../../lib/format'
import { ErrorNotice, Loading } from '../../../components/States'
import { PublicationBadge, ResponseStatusBadge } from '../adminUi'
import type { ResponseListItem, Retreat } from '../types'

type Filters = { status: string; publication: string; queue: 'all' | 'ready' | 'requests'; q: string }

export function ResponsesTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const [urlParams, setUrlParams] = useSearchParams()
  // Filters live in the address too, so a refresh shows the same list.
  const word = (key: string) => (/^[a-z_]{1,30}$/.test(urlParams.get(key) ?? '') ? urlParams.get(key)! : 'all')
  const [filters, setFilters] = useState<Filters>({
    status: word('status'),
    publication: word('publication'),
    queue: urlParams.get('queue') === 'requests' ? 'requests' : urlParams.get('queue') === 'ready' ? 'ready' : 'all',
    q: (urlParams.get('q') ?? '').slice(0, 100),
  })
  const [search, setSearch] = useState(filters.q)
  useEffect(() => {
    setUrlParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(filters)) {
          if (!v || v === 'all') out.delete(k)
          else out.set(k, v)
        }
        return out
      },
      { replace: true, preventScrollReset: true },
    )
  }, [filters, setUrlParams])
  // Search as you type, like the other filters (no button needed).
  useEffect(() => {
    const t = window.setTimeout(() => setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() })), 300)
    return () => window.clearTimeout(t)
  }, [search])
  const params = new URLSearchParams({ status: filters.status, publication: filters.publication, queue: filters.queue })
  if (filters.q) params.set('q', filters.q)

  const list = useQuery({
    queryKey: ['admin', orgSlug, 'responses', retreat.id, filters],
    queryFn: () => get<{ responses: ResponseListItem[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/responses?${params}`).then((r) => r.responses),
    placeholderData: keepPreviousData,
  })

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    setFilters((f) => ({ ...f, q: search.trim() }))
  }

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Queue">
        <button type="button" className={`btn small ${filters.queue === 'all' ? '' : 'secondary'}`} aria-pressed={filters.queue === 'all'} onClick={() => setFilters((f) => ({ ...f, queue: 'all' }))}>
          All submitted responses
        </button>
        <button
          type="button"
          className={`btn small ${filters.queue === 'ready' ? '' : 'secondary'}`}
          aria-pressed={filters.queue === 'ready'}
          onClick={() => setFilters((f) => ({ ...f, queue: 'ready' }))}
        >
          Ready to publish
        </button>
        <button
          type="button"
          className={`btn small ${filters.queue === 'requests' ? '' : 'secondary'}`}
          aria-pressed={filters.queue === 'requests'}
          onClick={() => setFilters((f) => ({ ...f, queue: 'requests' }))}
        >
          Change requests
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        “Ready to publish” lists submitted stories whose guest has consented to publication and which are not yet live. Ratings are never used to filter this list. Drafts never
        appear here.
      </p>

      <form className="card tight row" onSubmit={submitSearch} style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, flex: '1 1 160px' }}>
          <label htmlFor="rf-status">Response status</label>
          <select id="rf-status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="all">Any</option>
            <option value="submitted">Submitted</option>
            <option value="changes_requested">With guest for changes</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, flex: '1 1 160px' }}>
          <label htmlFor="rf-pub">Publication</label>
          <select id="rf-pub" value={filters.publication} onChange={(e) => setFilters((f) => ({ ...f, publication: e.target.value }))}>
            <option value="all">Any</option>
            <option value="none">Not published</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
            <option value="withdrawn">Withdrawn by guest</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, flex: '2 1 220px' }}>
          <label htmlFor="rf-q">Search guest name or story</label>
          <input id="rf-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn secondary" type="submit">
          Search
        </button>
      </form>

      {list.isLoading && <Loading />}
      {list.error && <ErrorNotice error={list.error} />}
      {list.data && list.data.length === 0 && <p className="muted">No responses match these filters.</p>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap card tight">
          <table className="data">
            <caption className="sr-only">Submitted responses</caption>
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col">Public story</th>
                <th scope="col">Photos</th>
                <th scope="col">Requests</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/admin/${orgSlug}/responses/${r.id}`} style={{ fontWeight: 600 }}>
                      {r.attendeeName}
                    </Link>
                    {r.pinned && <div className="small muted">Pinned</div>}
                    {r.updatedSincePublished && (
                      <div>
                        <span className="badge warn" title="The guest changed their review after it was published. The older approved version is still live.">
                          Updated since published
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="small">{formatDate(r.submittedAt)}</td>
                  <td>
                    <div className="stack" style={{ gap: '0.25rem' }}>
                      <ResponseStatusBadge status={r.status} />
                      <PublicationBadge status={r.publicationStatus} />
                    </div>
                  </td>
                  <td className="small" style={{ maxWidth: 380 }}>
                    {r.hasStory ? (
                      <>
                        <span>{r.storyPreview}</span>
                        <div className="muted" style={{ marginTop: '0.25rem' }}>
                          {r.consentPublicText ? 'Consented to publication' : 'Private — no publication consent'}
                          {r.consentPublicText && (r.consentFirstName ? ' · first name allowed' : ' · no name')}
                        </div>
                      </>
                    ) : (
                      <span className="muted">Private feedback only</span>
                    )}
                  </td>
                  <td>{r.photoCount}</td>
                  <td>{r.openChangeRequests > 0 ? <span className="badge warn">{r.openChangeRequests} open</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
