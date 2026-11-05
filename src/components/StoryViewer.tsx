import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

export interface ViewerSlide {
  url: string
  alt: string
  caption?: string
  focalX?: number
  focalY?: number
}

const SLIDE_MS = 6000
const MOTIONS = ['kb-in-left', 'kb-out-right', 'kb-in-up', 'kb-out-down'] as const

/**
 * Story-style photo viewer (as on Instagram): a tall frame with a progress bar per photo, the guest's
 * name over the top, slow zoom-and-pan, and auto-advance. Tap the left or right side (or use the
 * arrow keys) to move; press and hold, or the pause button, to stop. Reduced motion: still photos, no
 * auto-advance. It never moves in a background tab.
 */
export function StoryViewer({ slides, overlay, label }: { slides: ViewerSlide[]; overlay: ReactNode; label: string }) {
  const count = slides.length
  const [reduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(reduced)
  const [held, setHeld] = useState(false)
  const [hiddenTab, setHiddenTab] = useState(false)
  // Progress of the current photo, 0..1, advanced by animation frames so it pauses exactly.
  const [progress, setProgress] = useState(0)
  const last = useRef<number | null>(null)
  const progressRef = useRef(0)
  const pressStart = useRef<{ x: number; t: number } | null>(null)
  const stopped = paused || held || hiddenTab || count < 2

  useEffect(() => {
    const onVis = () => setHiddenTab(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (stopped) {
      last.current = null
      return
    }
    let raf = 0
    // Progress lives in a ref, and moving on happens here, outside any state updater: React may run
    // updaters twice (development), which would skip a photo, and with two photos land back on the first.
    const tick = (t: number) => {
      const dt = last.current === null ? 0 : t - last.current
      last.current = t
      progressRef.current += dt / SLIDE_MS
      if (progressRef.current >= 1) {
        progressRef.current = 0
        setIndex((i) => (i + 1) % count)
      }
      setProgress(progressRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stopped, count])

  if (!count) return null
  const go = (i: number) => {
    setIndex(((i % count) + count) % count)
    progressRef.current = 0
    setProgress(0)
  }
  const current = slides[index]

  function onPointerDown(e: PointerEvent) {
    pressStart.current = { x: e.clientX, t: Date.now() }
    setHeld(true)
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    setHeld(false)
    const start = pressStart.current
    pressStart.current = null
    if (!start || count < 2) return
    const dx = e.clientX - start.x
    if (Math.abs(dx) > 40) return go(index + (dx < 0 ? 1 : -1)) // swipe
    if (Date.now() - start.t > 350) return // press and hold only paused
    const rect = e.currentTarget.getBoundingClientRect()
    go(index + (e.clientX - rect.left < rect.width / 3 ? -1 : 1)) // tap: left third back, else forward
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(index + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(index - 1)
    } else if (e.key === ' ') {
      e.preventDefault()
      setPaused((p) => !p)
    }
  }

  return (
    <div className={`story-viewer ${stopped ? 'is-paused' : ''}`}>
      <div
        className="story-stage"
        role="region"
        aria-roledescription="carousel"
        aria-label={`${label}. ${count > 1 ? 'Tap the sides or use the arrow keys to move; space pauses.' : ''}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {slides.map((s, i) => (
          <img
            key={s.url + i}
            src={s.url}
            alt={i === index ? s.alt : ''}
            aria-hidden={i !== index}
            className={i === index ? `active ${MOTIONS[i % MOTIONS.length]}` : ''}
            style={{ animationDuration: `${SLIDE_MS + 1500}ms`, objectPosition: `${(s.focalX ?? 0.5) * 100}% ${(s.focalY ?? 0.5) * 100}%` }}
            draggable={false}
            loading={i < 2 ? 'eager' : 'lazy'}
          />
        ))}
      </div>

      {count > 1 && (
        <div className="story-bars" aria-hidden="true">
          {slides.map((s, i) => (
            <span key={s.url + i}>
              <span style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
      )}
      <div className="story-top">
        {overlay}
        {count > 1 && !reduced && (
          <button
            type="button"
            className="story-pause"
            aria-label={paused ? 'Play photos' : 'Pause photos'}
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
              {paused ? <path d="M2 1l9 5-9 5z" fill="currentColor" /> : <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" />}
            </svg>
          </button>
        )}
      </div>
      {current.caption && (
        <p className="story-caption" aria-live={stopped ? 'polite' : 'off'}>
          {current.caption}
        </p>
      )}
    </div>
  )
}
