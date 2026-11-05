import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { REVIEW_KINDS } from '../../../shared/categories'
import { get } from '../../lib/api'
import { formatRange } from '../../lib/format'
import { ErrorNotice, Loading } from '../../components/States'
import { SiteHeader } from './RetreatLanding'

interface OrgPublic {
  org: { slug: string; name: string; websiteUrl?: string | null }
  retreats: Array<{ slug: string; kind: 'itinerary' | 'property'; title: string; startDate: string | null; endDate: string | null; locationSummary: string }>
}

/** Every public retreat and property from one organiser, each linking to its own page. */
export function OrgSite({ orgSlug }: { orgSlug: string }) {
  const q = useQuery({ queryKey: ['public-org', orgSlug], queryFn: () => get<OrgPublic>(`/api/public/orgs/${orgSlug}`) })
  useEffect(() => {
    if (q.data) document.title = `Retreats by ${q.data.org.name}`
  }, [q.data])
  if (q.isLoading) return <Loading />
  if (q.error)
    return (
      <div className="container" style={{ padding: '3rem 0' }}>
        <ErrorNotice error={q.error} />
      </div>
    )
  const data = q.data!
  return (
    <div className="calm">
      <SiteHeader org={data.org} />
      <main className="container" style={{ padding: '1.5rem 0 4rem' }}>
        <p className="eyebrow">{data.org.name}</p>
        <h1>Retreats by {data.org.name}</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>
          Each page has the organiser’s own introduction and the stories guests have chosen to publish.
        </p>
        {data.retreats.length === 0 ? (
          <p className="muted">Retreats will appear here once they’re open.</p>
        ) : (
          <div className="story-cards" style={{ marginTop: '1.5rem' }}>
            {data.retreats.map((r) => (
              <Link key={r.slug} to={`/o/${orgSlug}/r/${r.slug}`} className="story-card">
                <span className="badge" style={{ justifySelf: 'start' }}>
                  {REVIEW_KINDS[r.kind].short}
                </span>
                <h2 style={{ fontSize: '1.4rem', margin: 0 }}>{r.title}</h2>
                {r.kind === 'itinerary' && <span className="muted">{formatRange(r.startDate, r.endDate)}</span>}
                {r.locationSummary && <span className="muted small">{r.locationSummary}</span>}
                <span className="small" style={{ fontWeight: 600 }}>
                  Read guest stories →
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default function OrgHome() {
  const { orgSlug = '' } = useParams()
  return <OrgSite orgSlug={orgSlug} />
}
