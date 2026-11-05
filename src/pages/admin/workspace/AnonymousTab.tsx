import { useQuery } from '@tanstack/react-query'
import { get, orgApi } from '../../../lib/api'
import { formatDate } from '../../../lib/format'
import { ErrorNotice, Loading } from '../../../components/States'
import { CopyField, publicRetreatUrl } from '../adminUi'
import type { Retreat } from '../types'

const NOTE_CATEGORIES: Record<string, string> = {
  instruction: 'Instruction and teaching',
  accommodation: 'Accommodation',
  food: 'Food',
  travel: 'Travel',
  safety: 'Safety',
  people: 'People and group',
  other: 'Other',
}

interface Note {
  message: string
  category: string | null
  receivedWeek: string
}

export function AnonymousTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const notes = useQuery({
    queryKey: ['admin', orgSlug, 'anonymous', retreat.id],
    queryFn: () => get<{ notes: Note[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/anonymous`).then((r) => r.notes),
  })
  const label = (key: string | null) => (key ? (NOTE_CATEGORIES[key] ?? key) : 'No category')

  return (
    <div className="stack">
      <div className="panel-sage">
        <h2 style={{ marginTop: 0 }}>How anonymous notes stay anonymous</h2>
        <p className="small" style={{ marginBottom: 0 }}>
          These notes come through a separate form with no invitation link. They are stored without any connection to a guest, response or link, and only the week they arrived is
          kept — not the exact time. Notes are listed by week, then alphabetically, so their order gives no clue about who wrote them. Please don’t try to work out the author.
        </p>
      </div>
      <CopyField label="Anonymous note form address" value={`${publicRetreatUrl(orgSlug, retreat.slug)}/anonymous`} hint="Share this with all guests at once, for example in a group message." />
      {notes.isLoading && <Loading />}
      {notes.error && <ErrorNotice error={notes.error} />}
      {notes.data && notes.data.length === 0 && <p className="muted">No anonymous notes yet.</p>}
      {notes.data && notes.data.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {notes.data.map((n, i) => (
            <li key={i} className="card tight">
              <div className="row small muted" style={{ marginBottom: '0.5rem' }}>
                <span>Week of {formatDate(n.receivedWeek)}</span>
                <span className="badge neutral">{label(n.category)}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
