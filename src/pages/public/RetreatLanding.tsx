import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { ThemeTokens } from '../../../shared/themes'
import { get } from '../../lib/api'
import { RetreatDetails, type RetreatFacts } from '../../components/RetreatDetails'
import { HeroSlideshow } from '../../components/HeroSlideshow'
import { ErrorNotice, Loading } from '../../components/States'
import type { ShowcaseStory } from '../../components/StoryShowcase'
import { ThemeScope } from '../../components/ThemeScope'

export interface RetreatPublic {
  org: { slug: string; name: string }
  retreat: RetreatFacts
  theme: ThemeTokens
  content: { headline: string; introParagraphs: string[]; ctaLabel: string; ctaUrl: string } | null
  hero: Array<{ url: string; alt: string; caption: string; credit: string; focalX: number; focalY: number }>
  stories: ShowcaseStory[]
}

export function SiteHeader({ org }: { org: { slug: string; name: string } }) {
  return (
    <header className="container site-header spread">
      <Link to={`/o/${org.slug}`} className="brand" style={{ color: 'var(--text)' }}>
        {org.name}
      </Link>
      <span className="small muted">Guest stories</span>
    </header>
  )
}

export function SiteFooter({ retreat, orgSlug }: { retreat: RetreatFacts; orgSlug: string }) {
  return (
    <footer className="site-footer">
      <div className="container spread small muted">
        <span>Stories are published with each guest’s permission and are shown exactly as they wrote them.</span>
        <span className="row">
          <Link to={`/o/${orgSlug}/privacy?programme=${retreat.slug}`}>Privacy</Link>
          <Link to="/legal/cookies">Cookies</Link>
          <span>Powered by Croot</span>
        </span>
      </div>
    </footer>
  )
}

export default function RetreatLanding() {
  const { orgSlug = '', retreatSlug = '' } = useParams()
  const q = useQuery({
    queryKey: ['public-retreat', orgSlug, retreatSlug],
    queryFn: () => get<RetreatPublic>(`/api/public/orgs/${orgSlug}/retreats/${retreatSlug}`),
  })
  useEffect(() => {
    if (q.data) document.title = `${q.data.retreat.title} · Guest stories · ${q.data.org.name}`
  }, [q.data])
  if (q.isLoading) return <Loading />
  if (q.error)
    return (
      <div className="container" style={{ padding: '3rem 0' }}>
        <ErrorNotice error={q.error} />
      </div>
    )
  const d = q.data!
  return (
    <ThemeScope tokens={d.theme}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader org={d.org} />
      <main id="main">
        {/* Contact and practical details first, so they're easy to find. */}
        <section className="container landing-top">
          <RetreatDetails retreat={d.retreat} />
        </section>

        {/* Photos on the left, the organiser's own words on the right (stacked on small screens). */}
        <section className={`container landing-hero ${d.hero.length ? '' : 'no-photos'}`}>
          {d.hero.length > 0 && (
            <div className="landing-photos" aria-label="Retreat photos">
              <HeroSlideshow slides={d.hero} />
            </div>
          )}
          <div className="landing-opening">
            {/* Organiser-written opening, visually distinct from guest testimony. */}
            <p className="eyebrow">From {d.retreat.organiserName || d.org.name}</p>
            <h1>{d.content?.headline ?? d.retreat.title}</h1>
            <div className="organiser-voice">
              {d.content?.introParagraphs.map((p) => <p key={p}>{p}</p>)}
              {d.content?.ctaLabel && d.content.ctaUrl && (
                <a className="btn" href={d.content.ctaUrl} target="_blank" rel="noopener noreferrer">
                  {d.content.ctaLabel}
                </a>
              )}
            </div>
          </div>
        </section>

        {/* Guest reviews last, each with the photos that guest chose to publish. */}
        <section className="container landing-reviews" aria-labelledby="reviews-title">
          <h2 id="reviews-title">What guests are saying</h2>
          {d.stories.length === 0 ? (
            <p className="muted">No guest stories have been published yet.</p>
          ) : (
            <ul className="review-list">
              {d.stories.map((s) => (
                <li key={s.slug} className={`review-item ${s.photos?.length ? '' : 'no-photos'}`}>
                  <div className="review-text">
                    <blockquote>
                      “{s.excerpt}
                      {s.excerptIsFull ? '' : ' …'}”
                    </blockquote>
                    <p className="review-by">— {s.displayName ?? 'A retreat guest'}</p>
                    {!s.excerptIsFull || (s.photos?.length ?? 0) > 0 ? (
                      <Link to={`/stories/${s.slug}`}>
                        Read full story<span className="sr-only">{s.displayName ? ` by ${s.displayName}` : ''}</span> →
                      </Link>
                    ) : null}
                  </div>
                  {s.photos && s.photos.length > 0 && (
                    <div className={`review-photos count-${Math.min(s.photos.length, 4)}`}>
                      {s.photos.slice(0, 4).map((p, i) => (
                        <img key={p.url} src={p.url} alt={p.alt} loading="lazy" className={i === 0 ? 'first' : ''} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter retreat={d.retreat} orgSlug={d.org.slug} />
    </ThemeScope>
  )
}
