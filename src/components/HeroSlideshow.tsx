import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { shortCaption } from '../lib/caption'

export interface HeroSlide {
  url: string
  alt: string
  caption: string
  credit: string
  focalX: number
  focalY: number
}

const SLIDE_MS = 7000
/** The same slow zoom-and-pan drifts as the review form's photo panel. */
const MOTIONS = ['kb-in-left', 'kb-out-right', 'kb-in-up', 'kb-out-down'] as const

/**
 * The public retreat page's photos: each fills the frame and slowly zooms and pans, fading to the next
 * every few seconds, with an attached caption band and dots. Swipe, arrow keys and dots move between
 * photos; a pause control stops the motion (WCAG 2.2.2). With reduced motion nothing moves or advances.
 */
export function HeroSlideshow({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0)
  const [reduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [paused, setPaused] = useState(reduced)
  const [tick, setTick] = useState(0)
  const [previous, setPrevious] = useState<number | null>(null)
  const shown = useRef(0)
  const appearances = useRef(0)
  const [motionOf, setMotionOf] = useState<Record<number, string>>({ 0: MOTIONS[0] })
  const startX = useRef<number | null>(null)
  const pausedByHiddenTab = useRef(false)
  const count = slides.length

  useEffect(() => {
    if (shown.current === index) return
    setPrevious(shown.current)
    shown.current = index
    appearances.current += 1
    setMotionOf((m) => ({ ...m, [index]: MOTIONS[appearances.current % MOTIONS.length] }))
  }, [index])

  useEffect(() => {
    if (paused || count < 2) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS)
    return () => window.clearTimeout(id)
  }, [index, tick, paused, count])

  // Nothing moves in a background tab.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setPaused((p) => {
          if (!p) pausedByHiddenTab.current = true
          return true
        })
      } else if (pausedByHiddenTab.current) {
        pausedByHiddenTab.current = false
        setPaused(false)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (!count) return null
  const go = (i: number) => {
    setIndex(((i % count) + count) % count)
    setTick((t) => t + 1)
  }
  const current = slides[index]

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(index + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(index - 1)
    }
  }
  function onPointerDown(e: PointerEvent) {
    startX.current = e.clientX
  }
  function onPointerUp(e: PointerEvent) {
    if (startX.current === null) return
    const dx = e.clientX - startX.current
    startX.current = null
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1))
  }

  return (
    <figure className={`hero-slides photo-panel ${paused ? 'is-paused' : ''}`}>
      <div
        className="photo-stage"
        role="region"
        aria-roledescription="carousel"
        aria-label={count > 1 ? 'Retreat photos. Use the left and right arrow keys or swipe to see more.' : 'Retreat photo'}
        tabIndex={count > 1 ? 0 : -1}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (startX.current = null)}
      >
        {slides.map((s, i) => (
          <img
            key={s.url}
            src={s.url}
            alt={i === index ? s.alt : ''}
            aria-hidden={i !== index}
            className={i === index ? `active ${motionOf[i] ?? MOTIONS[0]}` : i === previous ? `leaving ${motionOf[i] ?? MOTIONS[0]}` : ''}
            style={{ animationDuration: `${SLIDE_MS + 1500}ms`, objectPosition: `${s.focalX * 100}% ${s.focalY * 100}%` }}
            draggable={false}
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        ))}
      </div>
      <figcaption className="photo-band">
        <div aria-live={paused ? 'polite' : 'off'}>
          {current.caption && <p className="photo-line" aria-label={current.caption}>{shortCaption(current.caption)}</p>}
          {current.credit && <p className="photo-credit">Photo: {current.credit}</p>}
        </div>
        {count > 1 && (
          <div className="photo-controls">
            <div className="photo-dots" role="group" aria-label="Choose a photo">
              {slides.map((s, i) => (
                <button
                  key={s.url}
                  type="button"
                  className={i === index ? 'active' : ''}
                  aria-label={`Photo ${i + 1} of ${count}${s.caption ? `: ${s.caption}` : ''}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            {!reduced && (
              <button
                type="button"
                className="photo-pause"
                aria-label={paused ? 'Play slideshow' : 'Pause slideshow'}
                aria-pressed={paused}
                onClick={() => {
                  pausedByHiddenTab.current = false
                  setPaused((p) => !p)
                  setTick((t) => t + 1)
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  {paused ? <path d="M2 1l9 5-9 5z" fill="currentColor" /> : <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" />}
                </svg>
              </button>
            )}
          </div>
        )}
      </figcaption>
    </figure>
  )
}
