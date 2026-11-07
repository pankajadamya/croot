import { useCallback, useEffect, useRef, type PointerEvent } from 'react'

export interface ViewerItem {
  id: string
  /** The full-size photo (a video's poster). */
  url: string
  /** A video to play, with the browser's own controls. */
  video?: string | null
  alt: string
  caption?: string
  note?: string
}

/**
 * A photo or video at full size over the page: swipe, arrow keys or the edge buttons move through the
 * set; Esc or ✕ closes. Videos play with their controls (sound off until turned on). Same look as the
 * guests' album viewer (the .lightbox styles).
 */
export function MediaViewer({ items, index, onIndex, onClose }: { items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const m = items[index]
  const startX = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const go = useCallback((d: number) => onIndex((index + d + items.length) % items.length), [index, onIndex, items.length])

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [go, onClose])

  function onPointerDown(e: PointerEvent) {
    // Dragging along a video's own controls (seek bar, volume) must not change the photo.
    startX.current = (e.target as HTMLElement).tagName === 'VIDEO' ? null : e.clientX
  }
  function onPointerUp(e: PointerEvent) {
    if (startX.current === null) return
    const dx = e.clientX - startX.current
    startX.current = null
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
  }
  if (!m) return null
  const kind = m.video ? 'Video' : 'Photo'
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${kind} ${index + 1} of ${items.length}`}>
      <div className="lightbox-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onClick={(e) => e.target === e.currentTarget && onClose()}>
        {m.video ? (
          <video key={m.id} src={m.video} poster={m.url} controls autoPlay playsInline muted preload="metadata" aria-label={m.alt} />
        ) : (
          <img key={m.id} src={m.url} alt={m.alt} draggable={false} />
        )}
      </div>
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {items.length > 1 && (
        <>
          <button type="button" className="lightbox-edge left" onClick={() => go(-1)} aria-label="Previous">
            ‹
          </button>
          <button type="button" className="lightbox-edge right" onClick={() => go(1)} aria-label="Next">
            ›
          </button>
        </>
      )}
      <div className="lightbox-caption">
        <span className="lightbox-caption-text">{[m.caption, m.note].filter(Boolean).join(' · ')}</span>
        <span className="lightbox-count">
          {index + 1} / {items.length}
        </span>
      </div>
    </div>
  )
}
