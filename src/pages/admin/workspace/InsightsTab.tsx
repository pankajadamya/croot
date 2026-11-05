import { useQuery } from '@tanstack/react-query'
import { get, orgApi } from '../../../lib/api'
import { ErrorNotice, Loading } from '../../../components/States'
import { Stars, formatRating } from '../../../components/Stars'
import type { Retreat } from '../types'

interface Insights {
  submitted: number
  threshold: number
  hidden: boolean
  categories: Array<{
    key: string
    label: string
    answered: number
    notApplicable: number
    mean: number | null
    distribution: Array<{ score: number; label: string; count: number }>
  }>
}

export function InsightsTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const insights = useQuery({
    queryKey: ['admin', orgSlug, 'insights', retreat.id],
    queryFn: () => get<Insights>(`${orgApi(orgSlug)}/retreats/${retreat.id}/insights`),
  })
  const exportUrl = `${orgApi(orgSlug)}/retreats/${retreat.id}/export/private-feedback.csv`

  return (
    <div className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Private feedback by category</h2>
        <a className="btn secondary" href={exportUrl} download>
          Download private feedback (CSV)
        </a>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The download includes guest names and comments, so keep it somewhere private. Each download is recorded in the audit log.
      </p>
      {insights.isLoading && <Loading />}
      {insights.error && <ErrorNotice error={insights.error} />}
      {insights.data?.hidden && (
        <div className="notice warn" role="status">
          Category scores are hidden until at least {insights.data.threshold} guests have submitted ({insights.data.submitted} so far). With fewer responses, a score could reveal
          what one person said. You can still read each response individually.
        </div>
      )}
      {insights.data && !insights.data.hidden && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Based on {insights.data.submitted} submitted responses. “Not applicable” answers are counted separately and not included in the average.
          </p>
          <div className="table-wrap card tight">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Average</th>
                  <th scope="col">Answered</th>
                  <th scope="col">Not applicable</th>
                  <th scope="col">Spread</th>
                </tr>
              </thead>
              <tbody>
                {insights.data.categories.map((c) => (
                  <tr key={c.key}>
                    <th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem', color: 'var(--text)' }}>
                      {c.label}
                    </th>
                    <td>
                      {c.mean != null ? (
                        <span className="rating-cell">
                          <Stars value={Number(c.mean)} />
                          <span className="small">{formatRating(Number(c.mean))}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{c.answered}</td>
                    <td>{c.notApplicable}</td>
                    <td>
                      <ul className="dist" aria-label={`Spread of answers for ${c.label}`}>
                        {c.distribution.map((d) => (
                          <li key={d.score} title={`${d.label}: ${d.count}`}>
                            <span className="dist-bar" style={{ height: `${c.answered ? Math.max(4, (d.count / c.answered) * 48) : 4}px` }} aria-hidden="true" />
                            <span className="small">
                              {d.score}: {d.count}
                            </span>
                            <span className="sr-only"> ({d.label})</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
