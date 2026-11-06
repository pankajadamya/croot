import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FilmMusic } from '../../shared/film'
import { createFilmMusic, type FilmMusicPlayer } from '../lib/filmMusic'
import { shortCaption } from '../lib/caption'
import { formatRange } from '../lib/format'

/**
 * The album as a short film, played full screen in the browser: a title card, every photo and video
 * in the album's order (photos drift slowly, as in the retreat page slideshow; videos play through),
 * then a closing card, over music composed in the browser (lib/filmMusic.ts).
 *
 * It shows exactly what the album page it opens from shows, so the album's consent rules apply as
 * they are; nothing new is fetched or sent, and nothing can be downloaded.
 */
export interface FilmItem {
  id: string
  url: string
  alt: string
  caption: string
  /** A video to play; `url` is then its poster. */
  video: string | null
  duration: number | null
  focalX?: number
  focalY?: number
}
export interface FilmInfo {
  title: string
  organiser: string | null
  startDate: string | null
  endDate: string | null
  music: FilmMusic
}

export type FilmSlide = { kind: 'title' } | { kind: 'photo'; item: FilmItem } | { kind: 'video'; item: FilmItem } | { kind: 'end' }

export const TITLE_MS = 4500
export const PHOTO_MS = 6000
/** Reduced motion: nothing moves, so each photo stays a little longer and fades more slowly. */
export const STILL_PHOTO_MS = 7000
/** Videos play to the end, or this long at most, so one long clip doesn't take over the film. */
export const VIDEO_MAX_S = 15

const MOTIONS = ['kb-in-left', 'kb-out-right', 'kb-in-up', 'kb-out-down'] as const

export function filmSlides(items: FilmItem[]): FilmSlide[] {
  return [{ kind: 'title' }, ...items.map((item): FilmSlide => (item.video ? { kind: 'video', item } : { kind: 'photo', item })), { kind: 'end' }]
}

/** How long a slide stays on screen by itself; null when it decides (a video) or waits (the end). */
export function slideMs(slide: FilmSlide, reduced: boolean): number | null {
  if (slide.kind === 'title') return TITLE_MS
  if (slide.kind === 'photo') return reduced ? STILL_PHOTO_MS : PHOTO_MS
  return null
}

/** startPaused: opened from a link rather than a click, so sound isn't allowed until the viewer presses Play. */
export function MemoryFilm({ items, info, onClose, startPaused = false }: { items: FilmItem[]; info: FilmInfo; onClose: () => void; startPaused?: boolean }) {
  const slides = useMemo(() => filmSlides(items), [items])
  const [reduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [index, setIndex] = useState(0)
  const [previous, setPrevious] = useState<number | null>(null)
  const [paused, setPaused] = useState(startPaused)
  const [muted, setMuted] = useState(false)
  const [chrome, setChrome] = useState(true)
  const music = useRef<FilmMusicPlayer | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const playButton = useRef<HTMLButtonElement>(null)
  const left = useRef<{ index: number; ms: number } | null>(null)
  const startX = useRef<number | null>(null)
  const slide = slides[index]
  const atEnd = slide.kind === 'end'

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(slides.length - 1, to))
      if (next === index) return
      setPrevious(index)
      setIndex(next)
    },
    [index, slides.length],
  )

  // Music: made once, from the click that opened the film (browsers only allow sound after one).
  useEffect(() => {
    music.current = createFilmMusic(info.music)
    return () => {
      music.current?.close()
      music.current = null
    }
  }, [info.music])
  useEffect(() => {
    if (!music.current) return
    if (atEnd) music.current.fadeOut(5)
    else if (paused) music.current.pause()
    else music.current.play()
  }, [paused, atEnd])
  useEffect(() => music.current?.setMuted(muted), [muted])

  // Photos and cards move on by themselves; a pause keeps the time left on this slide.
  useEffect(() => {
    const ms = slideMs(slide, reduced)
    if (ms === null || paused) return
    const wait = left.current?.index === index ? left.current.ms : ms
    const started = performance.now()
    const id = window.setTimeout(() => go(index + 1), wait)
    return () => {
      window.clearTimeout(id)
      left.current = { index, ms: Math.max(0, wait - (performance.now() - started)) }
    }
  }, [slide, index, paused, reduced, go])

  // Videos: their own sound only when there is no music (and the viewer hasn't muted).
  const videoMuted = muted || info.music !== 'none'
  useEffect(() => {
    const v = video.current
    if (!v || slide.kind !== 'video') return
    if (paused) {
      v.pause()
      return
    }
    v.play().catch(() => {
      // Sound not allowed yet: play silently rather than not at all.
      v.muted = true
      void v.play().catch(() => undefined)
    })
  }, [slide, paused])

  // The next photo is fetched while this one shows.
  useEffect(() => {
    const next = slides[index + 1]
    if (next?.kind === 'photo') new Image().src = next.item.url
  }, [index, slides])

  // Controls fade away while it plays, and come back on any movement, touch or key.
  const hideTimer = useRef<number | null>(null)
  const wake = useCallback(() => {
    setChrome(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setChrome(false), 2800)
  }, [])
  useEffect(() => {
    wake()
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [wake])
  const showChrome = chrome || paused || atEnd

  const toggle = useCallback(() => {
    setPaused((p) => !p)
    wake()
  }, [wake])

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    playButton.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      wake()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(index + 1)
      else if (e.key === 'ArrowLeft') go(index - 1)
      else if (e.key === 'm' || e.key === 'M') setMuted((x) => !x)
      else if ((e.key === ' ' || e.key === 'k') && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      before?.focus?.()
    }
  }, [go, index, onClose, toggle, wake])

  function onPointerDown(e: ReactPointerEvent) {
    startX.current = e.clientX
  }
  function onPointerUp(e: ReactPointerEvent) {
    wake()
    if (startX.current === null) return
    const dx = e.clientX - startX.current
    startX.current = null
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1))
  }

  function restart() {
    left.current = null
    setPrevious(null)
    setIndex(0)
    setPaused(false)
    music.current?.close()
    music.current = createFilmMusic(info.music)
    music.current?.setMuted(muted)
    music.current?.play()
  }

  const cover = items[0]
  const dates = formatRange(info.startDate, info.endDate)
  const fadeMs = reduced ? 1600 : 1200
  const count = items.length
  const position = slide.kind === 'photo' || slide.kind === 'video' ? index : null

  function layer(i: number) {
    const s = slides[i]
    const state = i === index ? 'active' : 'leaving'
    const style = { animationDuration: `${fadeMs}ms` }
    if (s.kind === 'title' || s.kind === 'end') {
      return (
        <div key={`card-${s.kind}`} className={`film-layer film-card ${state}`} style={style}>
          {cover && <img className="film-card-bg" src={cover.url} alt="" aria-hidden="true" />}
          <div className="film-card-text">
            {s.kind === 'title' ? (
              <>
                <p className="film-eyebrow">Memories</p>
                <h2>{info.title}</h2>
                {dates && <p className="film-sub">{dates}</p>}
                {info.organiser && <p className="film-sub">with {info.organiser}</p>}
              </>
            ) : (
              <>
                <p className="film-eyebrow">{info.title}</p>
                <h2>Thank you for the memories</h2>
                {info.organiser && <p className="film-sub">{info.organiser}</p>}
                <div className="film-end-actions">
                  <button type="button" className="album-btn" onClick={restart}>
                    Watch again
                  </button>
                  <button type="button" className="album-btn ghost" onClick={onClose}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )
    }
    const item = s.item
    const objectPosition = `${(item.focalX ?? 0.5) * 100}% ${(item.focalY ?? 0.5) * 100}%`
    if (s.kind === 'video') {
      return (
        <div key={item.id} className={`film-layer ${state}`} style={style}>
          {i === index ? (
            <video
              ref={video}
              src={item.video!}
              poster={item.url}
              playsInline
              autoPlay
              muted={videoMuted}
              preload="auto"
              aria-label={item.alt}
              onEnded={() => go(index + 1)}
              onError={() => go(index + 1)}
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime >= VIDEO_MAX_S) go(index + 1)
              }}
            />
          ) : (
            <img src={item.url} alt="" aria-hidden="true" style={{ objectPosition }} />
          )}
        </div>
      )
    }
    const motion = reduced ? '' : MOTIONS[i % MOTIONS.length]
    return (
      <div key={item.id} className={`film-layer ${state}`} style={style}>
        <img
          src={item.url}
          alt={i === index ? item.alt : ''}
          aria-hidden={i !== index}
          className={motion}
          style={{ objectPosition, animationDuration: `${PHOTO_MS + fadeMs * 2}ms` }}
          draggable={false}
        />
      </div>
    )
  }

  const current = slide.kind === 'photo' || slide.kind === 'video' ? slide.item : null
  return (
    <div
      className={`film ${paused ? 'is-paused' : ''} ${showChrome ? '' : 'chrome-hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Memory film: ${info.title}`}
      onPointerMove={wake}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="film-stage">
        {previous !== null && previous !== index && layer(previous)}
        {layer(index)}
      </div>

      {current?.caption && <p className="film-caption">{shortCaption(current.caption, 110)}</p>}

      <div className="film-controls">
        <button type="button" className="film-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h2v12H3zM14 2v12L6 8z" fill="currentColor" /></svg>
        </button>
        <button ref={playButton} type="button" className="film-btn main" onClick={toggle} aria-label={paused ? 'Play' : 'Pause'} aria-pressed={paused} disabled={atEnd}>
          <svg viewBox="0 0 16 16" aria-hidden="true">{paused ? <path d="M4 2l10 6-10 6z" fill="currentColor" /> : <path d="M3 2h3.5v12H3zM9.5 2H13v12H9.5z" fill="currentColor" />}</svg>
        </button>
        <button type="button" className="film-btn" onClick={() => go(index + 1)} disabled={atEnd} aria-label="Next">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2h2v12h-2zM2 2v12l8-6z" fill="currentColor" /></svg>
        </button>
        <span className="film-count" aria-live="off">
          {position !== null ? `${position} / ${count}` : ''}
        </span>
        <button type="button" className="film-btn" onClick={() => setMuted((x) => !x)} aria-label={muted ? 'Sound on' : 'Mute'} aria-pressed={muted}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
            {muted ? <path d="M11 5.5l4 5M15 5.5l-4 5" stroke="currentColor" strokeWidth="1.5" /> : <path d="M11 5c1.3 1.6 1.3 4.4 0 6M13 3.5c2.2 2.6 2.2 6.4 0 9" stroke="currentColor" strokeWidth="1.3" fill="none" />}
          </svg>
        </button>
        <button type="button" className="film-btn" onClick={onClose} aria-label="Close the film">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" /></svg>
        </button>
      </div>
      <div className="film-progress" aria-hidden="true">
        <span style={{ width: `${(index / Math.max(1, slides.length - 1)) * 100}%` }} />
      </div>
    </div>
  )
}
