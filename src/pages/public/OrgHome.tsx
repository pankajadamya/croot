import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { REVIEW_KINDS } from '../../../shared/categories'
import { get } from '../../lib/api'
import { formatRange } from '../../lib/format'
import { ErrorNotice, Loading } from '../../components/States'
import { SiteHeader } from './RetreatLanding'
import { InterestSignup } from '../../components/InterestSignup'

interface OrgPublic {
  org: { slug: string; name: string; websiteUrl?: string | null }
  retreats: Array<{
    slug: string
    kind: 'itinerary' | 'property'
    title: string
    startDate: string | null
    endDate: string | null
    locationSummary: string
    image: { url: string; alt: string; focalX: number; focalY: number } | null
    storyCount: number
  }>
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
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader org={data.org} />
      <main id="main" className="container" style={{ padding: '1.5rem 0 3rem' }}>
        <h1>Retreats by {data.org.name}</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>
          Each page has the organiser’s own introduction and the stories guests have chosen to publish.
        </p>
        {data.retreats.length === 0 ? (
          <p className="muted">Retreats will appear here once they’re open.</p>
        ) : (
          <ul className="retreat-grid">
            {data.retreats.map((r) => (
              <li key={r.slug}>
                <Link to={`/o/${orgSlug}/r/${r.slug}`} className="retreat-tile">
                  {/* With a photo, it leads; without one, the card is text-first rather than an empty frame. */}
                  {r.image ? (
                    <div className="retreat-tile-image">
                      <img src={r.image.url} alt="" loading="lazy" style={{ objectPosition: `${r.image.focalX * 100}% ${r.image.focalY * 100}%` }} />
                      <span className="retreat-tile-kind">{REVIEW_KINDS[r.kind].short}</span>
                    </div>
                  ) : (
                    <div className="retreat-tile-band">
                      <span className="retreat-tile-kind">{REVIEW_KINDS[r.kind].short}</span>
                    </div>
                  )}
                  <div className="retreat-tile-body">
                    <h2>{r.title}</h2>
                    <p className="retreat-tile-meta">
                      {r.kind === 'itinerary' && formatRange(r.startDate, r.endDate)}
                      {r.kind === 'itinerary' && r.locationSummary && ' · '}
                      {r.locationSummary}
                    </p>
                    <div className="retreat-tile-foot">
                      <span className="small muted">
                        {r.storyCount > 0 ? `${r.storyCount} guest stor${r.storyCount === 1 ? 'y' : 'ies'}` : 'Guest stories coming soon'}
                      </span>
                      <span className="retreat-tile-cta" aria-hidden="true">
                        View retreat →
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 'clamp(2rem, 5vw, 3rem)' }}>
          <InterestSignup orgSlug={orgSlug} orgName={data.org.name} />
        </div>
      </main>
      <footer className="site-footer">
        <div className="container spread small muted">
          <span>Stories are published with each guest’s permission and shown exactly as they wrote them.</span>
          <span className="row">
            <Link to={`/o/${orgSlug}/privacy`}>Privacy</Link>
            <Link to="/legal/cookies">Cookies</Link>
            <span>Powered by Croot</span>
          </span>
        </div>
      </footer>
    </div>
  )
}

export default function OrgHome() {
  const { orgSlug = '' } = useParams()
  return <OrgSite orgSlug={orgSlug} />
}
