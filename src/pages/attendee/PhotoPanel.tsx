import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

export interface PanelSlide {
  url: string
  alt: string
  caption: string
}

/**
 * The left panel of the review form, as an immersive photo slider: the image fills the panel, the
 * retreat's name sits over a soft shade at the top, and a caption band with dots is attached at the
 * bottom. Navigation is by dots, swipe, or arrow keys when the panel has focus. It never moves on its
 * own, so it can't distract someone who's writing. Guests can hide it; without photos (or once hidden)
 * the plain panel is shown.
 */
export function PhotoPanel({
  slides,
  header,
  footer,
}: {
  slides: PanelSlide[]
  /** Organisation, retreat title and dates. */
  header: ReactNode
  /** Shown in the plain panel (e.g. the privacy reassurance). */
  footer: ReactNode
}) {
  const [hidden, setHidden] = useState(false)
  const [index, setIndex] = useState(0)
  const startX = useRef<number | null>(null)

  if (!slides.length || hidden) {
    return (
      <aside className="flow-visual" aria-label="Retreat">
        <div>{header}</div>
        {slides.length > 0 && (
          <button type="button" className="btn ghost small photo-show" onClick={() => setHidden(false)}>
            View retreat photos
          </button>
        )}
        <div className="hide-mobile">{footer}</div>
      </aside>
    )
  }

  const count = slides.length
  const go = (i: number) => setIndex(((i % count) + count) % count)
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
    <aside className="flow-visual photo-panel" aria-label="Retreat">
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
            className={i === index ? 'active' : ''}
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
        <div aria-live="polite">
          {current.caption && <p className="photo-eyebrow">{current.caption}</p>}
          <p className="photo-line">A little reminder of the journey</p>
        </div>
        {count > 1 && (
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
        )}
      </div>
    </aside>
  )
}
