import { useQuery } from '@tanstack/react-query'
import { get, orgApi } from '../../../lib/api'
import { ErrorNotice, Loading } from '../../../components/States'
import type { Retreat } from '../types'

interface Notes {
  notes: Array<{ message: string }>
  /** Notes received but not shown yet, until there are enough that none can be matched to a guest. */
  held: number
  minimum: number
}

export function AnonymousTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const q = useQuery({
    queryKey: ['admin', orgSlug, 'anonymous', retreat.id],
    queryFn: () => get<Notes>(`${orgApi(orgSlug)}/retreats/${retreat.id}/anonymous`),
  })

  return (
    <div className="stack">
      <div className="panel-sage">
        <h2 style={{ marginTop: 0 }}>How anonymous notes stay anonymous</h2>
        <p className="small" style={{ marginBottom: 0 }}>
          Guests can write an anonymous note in the review form. It’s sent separately from their review and stored on its own: no name, email,
          invitation, response or time of any kind is kept with it. Notes are listed alphabetically, and only once at least {q.data?.minimum ?? 3} have
          arrived, so neither their order nor a new one appearing hints at who wrote it. Please don’t try to work out the author.
        </p>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNotice error={q.error} />}
      {q.data && q.data.notes.length === 0 && (
        <p className="muted">
          {q.data.held > 0
            ? `${q.data.held} note${q.data.held === 1 ? ' has' : 's have'} arrived. They’ll show here once there are at least ${q.data.minimum}.`
            : 'No anonymous notes yet.'}
        </p>
      )}
      {q.data && q.data.notes.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {q.data.notes.map((n, i) => (
            <li key={i} className="card tight">
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
