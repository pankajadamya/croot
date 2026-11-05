import { Stars } from '../../components/Stars'
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { ThemeTokens } from '../../../shared/themes'
import { ApiError, get } from '../../lib/api'
import { RetreatDetails, type RetreatFacts } from '../../components/RetreatDetails'
import { Loading } from '../../components/States'
import { ThemeScope } from '../../components/ThemeScope'
import { SiteFooter, SiteHeader } from './RetreatLanding'

interface StoryPublic {
  org: { slug: string; name: string }
  retreat: RetreatFacts
  theme: ThemeTokens
  story: {
    slug: string
    title: string | null
    text: string
    excerpt: string
    displayName: string | null
    overallRating: number | null
    photos: Array<{ url: string; alt: string; caption: string; width: number; height: number }>
  }
}

/** Gentle reveal on scroll; content is fully present without it (reduced motion / no JS). */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>('.reveal:not(.visible)'))
    const show = (el: Element) => el.classList.add('visible')
    if (!('IntersectionObserver' in window)) return items.forEach(show)
    // Anything already on screen is shown at once; the rest fades in as it scrolls into view.
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (show(e.target), io.unobserve(e.target))), {
      rootMargin: '0px 0px -10% 0px',
    })
    for (const el of items) {
      if (el.getBoundingClientRect().top < window.innerHeight) show(el)
      else io.observe(el)
    }
    // Safety net: guest words must never stay hidden if the observer does not fire.
    const fallback = window.setTimeout(() => items.forEach(show), 1500)
    return () => {
      io.disconnect()
      window.clearTimeout(fallback)
    }
  })
  return ref
}

export default function StoryPage() {
  const { slug = '' } = useParams()
  const q = useQuery({ queryKey: ['public-story', slug], queryFn: () => get<StoryPublic>(`/api/public/stories/${slug}`), retry: false })
  const ref = useReveal()
  useEffect(() => {
    if (q.data) document.title = `${q.data.story.displayName ? `${q.data.story.displayName}’s story` : 'A guest story'} · ${q.data.retreat.title}`
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
  const { org, retreat, theme, story } = q.data!
  const paragraphs = story.text.split(/\n{2,}|\r\n\r\n/).filter((p) => p.trim())
  const retreatPath = `/o/${org.slug}/r/${retreat.slug}`

  return (
    <ThemeScope tokens={theme}>
      <a href="#main" className="skip-link">
        Skip to story
      </a>
      <SiteHeader org={org} />
      <main id="main" ref={ref}>
        <article>
          <header className="chapter" style={{ paddingTop: '2rem' }}>
            <div className="narrow">
              <p className="eyebrow">Guest story · {retreat.title}</p>
              <p className="serif reveal" style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.6rem)', lineHeight: 1.3 }}>
                “{story.excerpt}”
              </p>
              <p className="muted">{story.displayName ? `Written by ${story.displayName}` : 'Written by a retreat guest'}</p>
              {story.overallRating ? <p style={{ margin: 0 }}><Stars value={story.overallRating} size={20} /></p> : null}
            </div>
          </header>
          <section className="narrow" aria-labelledby="full-story">
            <h1 id="full-story" style={{ fontSize: '1.4rem' }}>
              {story.title || 'In their words'}
            </h1>
            <div className="guest-voice">
              {paragraphs.map((p, i) => (
                <p key={i} className="reveal" style={{ whiteSpace: 'pre-line' }}>
                  {p}
                </p>
              ))}
            </div>
          </section>
          {story.photos.length > 0 && (
            <section className="container chapter" aria-label="Photos shared by the guest">
              <div className="photo-grid">
                {story.photos.map((p) => (
                  <figure key={p.url} className="reveal" style={{ margin: 0 }}>
                    <img src={p.url} alt={p.alt || 'Photo shared by the guest'} width={p.width} height={p.height} loading="lazy" style={{ height: 'auto' }} />
                    {p.caption && <figcaption className="small muted">{p.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </section>
          )}
        </article>
        <section className="narrow chapter stack" aria-label="About the retreat">
          <p className="eyebrow">From the organiser</p>
          <RetreatDetails retreat={retreat} />
          <Link to={retreatPath} className="btn secondary">
            ← All stories from this retreat
          </Link>
        </section>
      </main>
      <SiteFooter retreat={retreat} orgSlug={org.slug} />
    </ThemeScope>
  )
}
