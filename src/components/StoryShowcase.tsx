import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'

export interface ShowcaseStory {
  slug: string
  excerpt: string
  excerptIsFull: boolean
  displayName: string | null
  photo: { url: string } | null
  photos?: Array<{ url: string; alt: string; caption: string }>
}

const FRAME_MS = 8000
const TICK_MS = 100

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Automatically advancing guest-story sequence.
 *   - 8 s per frame, visible progress, current/total, pause/play, previous/next, arrow keys.
 *   - Pauses when the visitor interacts, focuses inside, opens a story, or the tab is hidden.
 *   - Reduced motion: starts paused with no transition. One story: no autoplay, no loop.
 * Every quote is a verbatim, guest-approved excerpt; names appear only with consent.
 */
export function StoryShowcase({ stories }: { stories: ShowcaseStory[] }) {
  const reduced = prefersReducedMotion()
  const single = stories.length <= 1
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(!reduced && !single)
  const [elapsed, setElapsed] = useState(0)
  const pausedByUser = useRef(false)
  const regionRef = useRef<HTMLElement>(null)

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + stories.length) % stories.length)
      setElapsed(0)
    },
    [stories.length],
  )

  const pause = useCallback(() => {
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setElapsed((e) => {
        if (e + TICK_MS >= FRAME_MS) {
          setIndex((i) => (i + 1) % stories.length)
          return 0
        }
        return e + TICK_MS
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [playing, stories.length])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (!stories.length) return null
  const story = stories[index]

  function onKeyDown(e: KeyboardEvent) {
    if (single) return
    if (e.key === 'ArrowRight') {
      pause()
      go(1)
    } else if (e.key === 'ArrowLeft') {
      pause()
      go(-1)
    }
  }

  return (
    <section
      ref={regionRef}
      className="showcase"
      aria-roledescription="carousel"
      aria-label="Guest stories"
      onKeyDown={onKeyDown}
      // Focus moving into the story pauses it, so keyboard and screen-reader users can read.
      onFocus={() => {
        if (playing) pause()
      }}
      onPointerDown={() => {
        if (playing) pause()
      }}
    >
      <div
        key={story.slug}
        className={`showcase-frame ${story.photo ? '' : 'no-photo'} ${reduced ? '' : 'fade-in'}`}
        role="group"
        aria-roledescription="slide"
        aria-label={`Story ${index + 1} of ${stories.length}`}
      >
        {story.photo && <img className="showcase-photo" src={story.photo.url} alt="" />}
        <div className="showcase-quote">
          <p className="eyebrow" style={{ color: 'inherit', opacity: 0.85 }}>
            Guest story
          </p>
          <blockquote>
            “{story.excerpt}
            {story.excerptIsFull ? '' : ' …'}”
          </blockquote>
          <p style={{ margin: 0 }}>{story.displayName ? `— ${story.displayName}` : '— A retreat guest'}</p>
          <Link to={`/stories/${story.slug}`} onClick={pause}>
            Read full story<span className="sr-only">{story.displayName ? ` by ${story.displayName}` : ''}</span> →
          </Link>
        </div>
      </div>
      {!single && (
        <div className="showcase-controls">
          <button type="button" onClick={() => { pause(); go(-1) }} aria-label="Previous story">
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              pausedByUser.current = playing
              setPlaying(!playing)
            }}
            aria-label={playing ? 'Pause stories' : 'Play stories'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button type="button" onClick={() => { pause(); go(1) }} aria-label="Next story">
            →
          </button>
          <span aria-live={playing ? 'off' : 'polite'} style={{ minWidth: '4.5rem', textAlign: 'center' }}>
            {index + 1} / {stories.length}
          </span>
          <div className="showcase-progress" aria-hidden="true">
            <div style={{ width: `${(elapsed / FRAME_MS) * 100}%` }} />
          </div>
          <span className="small" style={{ opacity: 0.85 }}>
            {playing ? 'Playing' : 'Paused'}
          </span>
        </div>
      )}
    </section>
  )
}
