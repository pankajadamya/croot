import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { ThemeTokens } from '../../../shared/themes'
import { get } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { RetreatDetails, type RetreatFacts } from '../../components/RetreatDetails'
import { HeroSlideshow } from '../../components/HeroSlideshow'
import { InterestDialog, InterestSignup } from '../../components/InterestSignup'
import { HeartButton, useHearts } from '../../components/Hearts'
import { HelpfulButton, useHelpful } from '../../components/Helpful'
import { Stars, formatRating } from '../../components/Stars'
import { ErrorNotice, Loading } from '../../components/States'
import type { ShowcaseStory } from '../../components/StoryShowcase'
import { ThemeScope } from '../../components/ThemeScope'

export interface PublicAlbum {
  url: string
  count: number
  cover: string
  preview: string[]
}

export interface RetreatPublic {
  album?: PublicAlbum | null
  org: { slug: string; name: string; websiteUrl?: string | null }
  retreat: RetreatFacts
  rating: { average: number; count: number } | null
  theme: ThemeTokens
  content: { headline: string; introParagraphs: string[]; ctaLabel: string; ctaUrl: string } | null
  hero: Array<{ url: string; alt: string; caption: string; credit: string; focalX: number; focalY: number }>
  stories: ShowcaseStory[]
}

export function SiteHeader({ org }: { org: { slug: string; name: string; websiteUrl?: string | null } }) {
  return (
    <header className="container site-header spread">
      <Link to={`/o/${org.slug}`} className="brand" style={{ color: 'var(--text)' }}>
        {org.name}
      </Link>
      <nav className="site-header-nav" aria-label={org.name}>
        <Link className="site-header-link" to={`/o/${org.slug}`}>
          All retreats
        </Link>
        {org.websiteUrl && (
          <a className="site-header-link" href={org.websiteUrl} target="_blank" rel="noopener noreferrer">
            {siteLabel(org.websiteUrl)} ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <Link to="/" className="site-croot" aria-label="Croot home page">
          <img src="/croot-logo.svg" alt="Croot" />
        </Link>
      </nav>
    </header>
  )
}

/** "balanceandbeyond.co.uk" from "https://www.balanceandbeyond.co.uk/…". */
export function siteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Website'
  }
}

export function AlbumPromo({ album, title }: { album: PublicAlbum; title: string }) {
  return (
    <a className="album-promo" href={album.url}>
      <img className="album-promo-cover" src={album.cover} alt="" />
      <span className="album-promo-shade" aria-hidden="true" />
      <span className="album-promo-text">
        <span className="album-promo-eyebrow">Photo album · {album.count} photo{album.count === 1 ? '' : 's'}</span>
        <span className="album-promo-title">{title}</span>
        <span className="album-promo-cta">View the album →</span>
      </span>
      {album.preview.length > 0 && (
        <span className="album-promo-strip" aria-hidden="true">
          {album.preview.map((u) => (
            <img key={u} src={u} alt="" loading="lazy" />
          ))}
        </span>
      )}
    </a>
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
  const [updatesOpen, setUpdatesOpen] = useState(false)
  // Hearts on the review photos (same one-per-browser rules as the album).
  const reviewPhotos = (q.data?.stories ?? []).flatMap((s) => s.photos ?? [])
  const hearts = useHearts('', reviewPhotos, `/api/public/orgs/${orgSlug}/retreats/${retreatSlug}/album`)
  const helpful = useHelpful((q.data?.stories ?? []).map((s) => ({ slug: s.slug, helpful: s.helpful ?? 0 })))
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
        {/* The photo album leads, with the retreat's details in a narrow card beside it. */}
        <section className={`container landing-top ${d.album ? 'with-album' : ''}`}>
          {d.album && <AlbumPromo album={d.album} title={`Photos from ${d.retreat.title}`} />}
          <RetreatDetails retreat={d.retreat} organiser={{ name: d.org.name, websiteUrl: d.org.websiteUrl ?? null, retreatsPath: `/o/${d.org.slug}`, onGetUpdates: () => setUpdatesOpen(true) }} />
          <InterestDialog open={updatesOpen} onClose={() => setUpdatesOpen(false)} orgSlug={d.org.slug} orgName={d.org.name} retreatSlug={d.retreat.slug} />
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
            {d.rating && (
              <a className="rating-summary" href="#reviews-title">
                <Stars value={d.rating.average} size={22} />
                <strong>{formatRating(d.rating.average)}</strong>
                <span className="muted">
                  from {d.rating.count} guest review{d.rating.count === 1 ? '' : 's'}
                </span>
              </a>
            )}
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

        <div className="container" id="next-retreat" style={{ marginTop: 'clamp(2rem, 5vw, 3rem)' }}>
          <InterestSignup orgSlug={d.org.slug} orgName={d.org.name} retreatSlug={d.retreat.slug} />
        </div>

        {/* Guest reviews last, each with the photos that guest chose to publish. */}
        <section className="container landing-reviews" aria-labelledby="reviews-title">
          <div className="reviews-head">
            <h2 id="reviews-title">What guests are saying</h2>
            {d.rating && (
              <span className="rating-summary small-summary">
                <Stars value={d.rating.average} />
                <strong>{formatRating(d.rating.average)}</strong>
                <span className="muted">· {d.rating.count} rated</span>
              </span>
            )}
          </div>
          {d.stories.length === 0 ? (
            <p className="muted">No guest stories have been published yet.</p>
          ) : (
            <ul className="review-list">
              {d.stories.map((s) => (
                <li key={s.slug} className={`review-item ${s.photos?.length ? '' : 'no-photos'}`}>
                  <article className="review-text">
                    {/* Who and when first, then the guest's own words. */}
                    <header className="review-meta">
                      <span className="review-avatar" aria-hidden="true">
                        {(s.displayName ?? 'G').slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <span className="review-name">{s.displayName ?? 'A retreat guest'}</span>
                        {s.postedAt && (
                          <time className="review-date" dateTime={s.postedAt}>
                            {formatDate(s.postedAt)}
                          </time>
                        )}
                      </span>
                    </header>
                    {s.overallRating ? (
                      <div className="review-stars">
                        <Stars value={s.overallRating} />
                      </div>
                    ) : null}
                    {s.title && <h3 className="review-title">{s.title}</h3>}
                    <div className="review-body">
                      {(s.text ?? s.excerpt)
                        .split(/\n\s*\n/)
                        .map((p) => p.trim())
                        .filter(Boolean)
                        .map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                    </div>
                    <HelpfulButton on={helpful.voted(s.slug)} count={helpful.count({ slug: s.slug, helpful: s.helpful ?? 0 })} onToggle={() => void helpful.toggle({ slug: s.slug, helpful: s.helpful ?? 0 })} />
                  </article>
                  {s.photos && s.photos.length > 0 && (
                    <div className={`review-photos count-${Math.min(s.photos.length, 4)}`}>
                      {s.photos.slice(0, 4).map((p, i) => (
                        <div key={p.url} className={`review-photo ${i === 0 ? 'first' : ''}`}>
                          <img src={p.url} alt={p.alt} loading="lazy" />
                          {hearts.enabled && <HeartButton on={hearts.hearted(p.id)} count={hearts.count(p)} onToggle={() => void hearts.toggle(p)} />}
                        </div>
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
