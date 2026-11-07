import { VerifiedBadge } from '../../components/VerifiedBadge'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { ThemeTokens } from '../../../shared/themes'
import { ApiError, get } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { RetreatDetails, type RetreatFacts } from '../../components/RetreatDetails'
import { Loading } from '../../components/States'
import { Stars } from '../../components/Stars'
import { HelpfulButton, useHelpful } from '../../components/Helpful'
import { StoryViewer, type ViewerSlide } from '../../components/StoryViewer'
import { ThemeScope } from '../../components/ThemeScope'
import { SiteFooter, SiteHeader } from './RetreatLanding'

interface StoryPublic {
  org: { slug: string; name: string; websiteUrl?: string | null }
  retreat: RetreatFacts
  theme: ThemeTokens
  retreatPhotos: Array<{ url: string; alt: string; caption: string; credit: string; focalX: number; focalY: number }>
  more: Array<{ slug: string; title: string | null; excerpt: string; displayName: string | null; postedAt: string; overallRating: number | null; image: string | null }>
  story: {
    slug: string
    postedAt: string
    helpful: number
    title: string | null
    text: string
    excerpt: string
    displayName: string | null
    overallRating: number | null
    verified?: boolean
    photos: Array<{ url: string; alt: string; caption: string; width: number; height: number }>
  }
}

function Avatar({ name }: { name: string | null }) {
  return (
    <span className="story-avatar" aria-hidden="true">
      {(name ?? 'G').slice(0, 1).toUpperCase()}
    </span>
  )
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)

export default function StoryPage() {
  const { slug = '' } = useParams()
  const q = useQuery({ queryKey: ['public-story', slug], queryFn: () => get<StoryPublic>(`/api/public/stories/${slug}`), retry: false })
  const helpful = useHelpful(q.data ? [{ slug: q.data.story.slug, helpful: q.data.story.helpful }] : [])
  useEffect(() => {
    if (q.data) document.title = `${q.data.story.title ?? (q.data.story.displayName ? `${q.data.story.displayName}’s story` : 'A guest story')} · ${q.data.retreat.title}`
    window.scrollTo({ top: 0 })
  }, [q.data])

  if (q.isLoading) return <Loading />
  if (q.error) {
    const gone = q.error instanceof ApiError && q.error.status === 410
    return (
      <main className="calm">
        <div className="narrow" style={{ padding: '5rem 0' }}>
          <h1>{gone ? 'This story is no longer available' : 'Story not found'}</h1>
          <p className="muted">It may have been withdrawn by the guest or taken down by the organiser.</p>
          <Link to="/">Go to the home page</Link>
        </div>
      </main>
    )
  }
  const { org, retreat, theme, story, retreatPhotos, more } = q.data!
  const paragraphs = story.text.split(/\n{2,}|\r\n\r\n/).filter((p) => p.trim())
  const retreatPath = `/o/${org.slug}/r/${retreat.slug}`
  const name = story.displayName ?? 'A retreat guest'

  // The guest's own photos first; without any, the organiser's photos from the retreat.
  const own = story.photos.length > 0
  const slides: ViewerSlide[] = own
    ? story.photos.map((p) => ({ url: p.url, alt: p.alt || `Photo shared by ${name}`, caption: p.caption }))
    : retreatPhotos.map((p) => ({ url: p.url, alt: p.alt, caption: p.caption, focalX: p.focalX, focalY: p.focalY }))

  const byline = (
    <div className="story-byline">
      <Avatar name={story.displayName} />
      <span>
        <span className="story-byline-name">{name}</span>
        <span className="story-byline-sub">
          <time dateTime={story.postedAt}>{formatDate(story.postedAt)}</time> · {own ? 'their photos' : 'photos from the retreat'}
        </span>
      </span>
    </div>
  )

  return (
    <ThemeScope tokens={theme}>
      <a href="#story-text" className="skip-link">
        Skip to story
      </a>
      <SiteHeader org={org} />
      <main id="main">
        <div className="story-theatre">
          <div className={`container story-layout ${slides.length ? '' : 'no-media'}`}>
            {slides.length > 0 && (
              <div className="story-media">
                <StoryViewer slides={slides} overlay={byline} label={own ? `Photos shared by ${name}` : `Photos from ${retreat.title}`} />
              </div>
            )}

            <article className="story-panel" aria-labelledby="story-heading">
              <div className="story-panel-head">
                <Avatar name={story.displayName} />
                <span>
                  <span className="story-byline-name">
                    {name}
                    {story.verified && <VerifiedBadge />}
                  </span>
                  <span className="muted small">
                    <time dateTime={story.postedAt}>{formatDate(story.postedAt)}</time> · <Link to={retreatPath}>{retreat.title}</Link>
                  </span>
                </span>
              </div>
              {story.overallRating ? (
                <div style={{ marginTop: '0.9rem' }}>
                  <Stars value={story.overallRating} size={22} />
                </div>
              ) : null}
              {/* Without a title the words speak for themselves; the heading stays for screen readers. */}
              <h1 id="story-heading" className={story.title ? 'story-heading' : 'sr-only'}>
                {story.title ?? `${name}’s story`}
              </h1>
              {!story.title && <div style={{ height: '0.9rem' }} aria-hidden="true" />}
              <div id="story-text" className="story-words">
                {paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <div className="row" style={{ marginTop: '1.25rem' }}>
                <HelpfulButton on={helpful.voted(story.slug)} count={helpful.count({ slug: story.slug, helpful: story.helpful })} onToggle={() => void helpful.toggle({ slug: story.slug, helpful: story.helpful })} />
                {helpful.message && (
                  <p className="notice error small" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
                    {helpful.message}
                  </p>
                )}
                <Link to={retreatPath} className="btn secondary small">
                  ← All stories from this retreat
                </Link>
              </div>
            </article>
          </div>
        </div>

        {more.length > 0 && (
          <section className="container story-more" aria-labelledby="more-title">
            <h2 id="more-title">More stories from {retreat.title}</h2>
            <ul className="up-next">
              {more.map((m) => (
                <li key={m.slug}>
                  <Link to={`/stories/${m.slug}`} className="up-next-card">
                    <div className="up-next-thumb">{m.image ? <img src={m.image} alt="" loading="lazy" /> : <span aria-hidden="true">“</span>}</div>
                    <div className="up-next-body">
                      <span className="up-next-title">{m.title ?? `“${short(m.excerpt, 80)}”`}</span>
                      <span className="small muted">
                        {m.displayName ?? 'A retreat guest'} · {formatDate(m.postedAt)}
                      </span>
                      {m.overallRating ? <Stars value={m.overallRating} size={14} /> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="container story-about" aria-label="About the retreat">
          <RetreatDetails retreat={retreat} organiser={{ name: org.name, websiteUrl: org.websiteUrl ?? null, retreatsPath: `/o/${org.slug}` }} />
        </section>
      </main>
      <SiteFooter retreat={retreat} orgSlug={org.slug} />
    </ThemeScope>
  )
}
