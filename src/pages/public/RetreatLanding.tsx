import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { ThemeTokens } from '../../../shared/themes'
import { get } from '../../lib/api'
import { RetreatDetails, type RetreatFacts } from '../../components/RetreatDetails'
import { ErrorNotice, Loading } from '../../components/States'
import { StoryShowcase, type ShowcaseStory } from '../../components/StoryShowcase'
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

export function SiteFooter({ retreat }: { retreat: RetreatFacts }) {
  return (
    <footer className="site-footer">
      <div className="container spread small muted">
        <span>Stories are published with each guest’s permission and are shown exactly as they wrote them.</span>
        <span className="row">
          {retreat.privacyUrl && (
            <a href={retreat.privacyUrl} target="_blank" rel="noopener noreferrer">
              Privacy
            </a>
          )}
          <span>Powered by croot</span>
        </span>
      </div>
    </footer>
  )
}

function HeroSlides({ images }: { images: RetreatPublic['hero'] }) {
  const [i, setI] = useState(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    if (images.length < 2 || reduced) return
    const id = window.setInterval(() => setI((x) => (x + 1) % images.length), 7000)
    return () => window.clearInterval(id)
  }, [images.length, reduced])
  if (!images.length) return null
  const img = images[i]
  return (
    <figure style={{ margin: 0 }}>
      <img
        src={img.url}
        alt={img.alt}
        style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', objectPosition: `${img.focalX * 100}% ${img.focalY * 100}%`, borderRadius: 'var(--radius-lg)' }}
      />
      {(img.caption || img.credit) && (
        <figcaption className="small muted" style={{ marginTop: '0.4rem' }}>
          {img.caption}
          {img.credit && ` · ${img.credit}`}
        </figcaption>
      )}
    </figure>
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
        <section className="container hero">
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
        </section>
        {d.hero.length > 0 && (
          <section className="container" aria-label="Retreat photos">
            <HeroSlides images={d.hero} />
          </section>
        )}
        <section className="container" style={{ marginTop: '2.5rem' }}>
          {d.stories.length > 0 ? (
            <>
              <h2 className="sr-only">Guest stories</h2>
              <StoryShowcase stories={d.stories} />
            </>
          ) : null}
        </section>
        <section className="container" style={{ marginTop: '2rem' }}>
          <RetreatDetails retreat={d.retreat} defaultOpen={d.stories.length === 0} />
        </section>
        {d.stories.length > 1 && (
          <section className="container" style={{ marginTop: '3rem' }}>
            <h2>All stories</h2>
            <div className="story-cards">
              {d.stories.map((s) => (
                <Link key={s.slug} to={`/stories/${s.slug}`} className="story-card">
                  <blockquote>
                    “{s.excerpt}
                    {s.excerptIsFull ? '' : ' …'}”
                  </blockquote>
                  <span className="muted small">{s.displayName ?? 'A retreat guest'} · Read full story →</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <SiteFooter retreat={d.retreat} />
    </ThemeScope>
  )
}
