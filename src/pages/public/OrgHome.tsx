import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams } from 'react-router'
import { REVIEW_KINDS } from '../../../shared/categories'
import { get } from '../../lib/api'
import { formatRange } from '../../lib/format'
import { ErrorNotice, Loading } from '../../components/States'

interface OrgPublic {
  org: { slug: string; name: string }
  retreats: Array<{ slug: string; kind: 'itinerary' | 'property'; title: string; startDate: string | null; endDate: string | null; locationSummary: string }>
}

export function OrgSite({ orgSlug }: { orgSlug: string }) {
  const q = useQuery({ queryKey: ['public-org', orgSlug], queryFn: () => get<OrgPublic>(`/api/public/orgs/${orgSlug}`) })
  if (q.isLoading) return <Loading />
  if (q.error) return <div className="container" style={{ padding: '3rem 0' }}><ErrorNotice error={q.error} /></div>
  const data = q.data!
  // A single retreat goes straight to its showcase.
  if (data.retreats.length === 1) return <Navigate to={`/o/${orgSlug}/r/${data.retreats[0].slug}`} replace />
  return (
    <main className="calm">
      <div className="container" style={{ padding: '3rem 0' }}>
        <p className="eyebrow">{data.org.name}</p>
        <h1>Guest stories</h1>
        {data.retreats.length === 0 ? (
          <p className="muted">Stories will appear here once guests have shared them.</p>
        ) : (
          <div className="story-cards">
            {data.retreats.map((r) => (
              <Link key={r.slug} to={`/o/${orgSlug}/r/${r.slug}`} className="story-card">
                <span className="badge" style={{ justifySelf: 'start' }}>
                  {REVIEW_KINDS[r.kind].short}
                </span>
                <h2 style={{ fontSize: '1.4rem' }}>{r.title}</h2>
                {r.kind === 'itinerary' && <span className="muted">{formatRange(r.startDate, r.endDate)}</span>}
                <span className="muted small">{r.locationSummary}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

export default function OrgHome() {
  const { orgSlug = '' } = useParams()
  return <OrgSite orgSlug={orgSlug} />
}
