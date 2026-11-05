import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

export interface PanelSlide {
  url: string
  alt: string
  caption: string
}

/** How long each photo stays before the next one fades in. */
const SLIDE_MS = 7000
/** Each photo drifts a different way: slow zoom in or out with a gentle pan. */
const MOTIONS = ['kb-in-left', 'kb-out-right', 'kb-in-up', 'kb-out-down'] as const

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * The left panel of the review form, as an immersive photo slider: each photo fills the panel and
 * slowly zooms and pans; the retreat's name sits over a soft shade at the top, and a caption band with
 * dots is attached at the bottom. It advances on its own every few seconds. Dots jump to a photo (and
 * restart the timer), swipe and arrow keys work too, and a small pause control stops the motion
 * (WCAG 2.2.2). With reduced motion it neither moves nor advances. Guests can hide it; without photos
 * (or once hidden) the plain panel is shown.
 */
export function PhotoPanel({
  slides,
  header,
  footer,
  compactOnMobile = false,
}: {
  slides: PanelSlide[]
  /** Organisation, retreat title and dates. */
  header: ReactNode
  /** Shown in the plain panel (e.g. the privacy reassurance). */
  footer: ReactNode
  /** After the first step, phones get a short strip so the form isn't pushed down. */
  compactOnMobile?: boolean
}) {
  // "Hide photos" is remembered on this device.
  const [hidden, setHiddenState] = useState(() => {
    try {
      return window.localStorage.getItem('croot.hidePhotos') === '1'
    } catch {
      return false
    }
  })
  const setHidden = (v: boolean) => {
    setHiddenState(v)
    try {
      window.localStorage.setItem('croot.hidePhotos', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const [index, setIndex] = useState(0)
  const [reduced] = useState(prefersReducedMotion)
  const [paused, setPaused] = useState(reduced)
  // Bumped whenever the guest picks a photo, so the timer restarts from that moment.
  const [tick, setTick] = useState(0)
  const startX = useRef<number | null>(null)
  const pausedByHiddenTab = useRef(false)
  // The photo that is fading out keeps its drift, so it doesn't snap back mid-fade.
  const [previous, setPrevious] = useState<number | null>(null)
  const shown = useRef(index)
  const count = slides.length

  // Each time a photo appears it gets the next motion in the rotation, so its drift always restarts
  // (and differs from last time), even when only two photos alternate.
  const appearances = useRef(0)
  const [motionOf, setMotionOf] = useState<Record<number, string>>({ 0: MOTIONS[0] })
  useEffect(() => {
    if (shown.current === index) return
    setPrevious(shown.current)
    shown.current = index
    appearances.current += 1
    setMotionOf((m) => ({ ...m, [index]: MOTIONS[appearances.current % MOTIONS.length] }))
  }, [index])

  useEffect(() => {
    if (hidden || paused || count < 2) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS)
    return () => window.clearTimeout(id)
  }, [index, tick, hidden, paused, count])

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

  if (!count || hidden) {
    return (
      <aside className="flow-visual" aria-label="Retreat">
        <div>{header}</div>
        {count > 0 && (
          <button type="button" className="btn ghost small photo-show" onClick={() => setHidden(false)}>
            View retreat photos
          </button>
        )}
        <div className="hide-mobile">{footer}</div>
      </aside>
    )
  }

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
    <aside className={`flow-visual photo-panel ${paused ? 'is-paused' : ''} ${compactOnMobile ? 'mobile-compact' : ''}`} aria-label="Retreat">
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
            // The motion class is applied only while active, so each photo's drift restarts when it returns.
            className={i === index ? `active ${motionOf[i] ?? MOTIONS[0]}` : i === previous ? `leaving ${motionOf[i] ?? MOTIONS[0]}` : ''}
            style={{ animationDuration: `${SLIDE_MS + 1500}ms` }}
            draggable={false}
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        ))}
      </div>

      <div className="photo-top">
        <div>{header}</div>
        <button type="button" className="photo-hide" onClick={() => setHidden(true)}>
          Hide photos
        </button>
      </div>

      <div className="photo-band">
        <div aria-live={paused ? 'polite' : 'off'}>
          {current.caption && <p className="photo-eyebrow">{current.caption}</p>}
          <p className="photo-line">A little reminder of the journey</p>
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
      </div>
    </aside>
  )
}
