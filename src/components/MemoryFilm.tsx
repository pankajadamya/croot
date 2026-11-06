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
  /** Pixel size, to tell portrait from landscape (both unknown: treated as landscape). */
  width?: number
  height?: number
}
export interface FilmInfo {
  title: string
  organiser: string | null
  startDate: string | null
  endDate: string | null
  music: FilmMusic
}

/** How a screen of photos is laid out: one, two side by side or stacked, one large and two small, or four. */
export type PhotoLayout = 'single' | 'pair-cols' | 'pair-rows' | 'trio-cols' | 'trio-rows' | 'quad'

export type FilmSlide =
  | { kind: 'title'; ms: number }
  | { kind: 'photos'; items: FilmItem[]; layout: PhotoLayout; ms: number }
  | { kind: 'video'; item: FilmItem }
  | { kind: 'end' }

/** The whole film aims to last about this long. */
export const TARGET_MS = 60_000
export const TITLE_MS = 3000
/** A screen of photos shows for at most this long (shorter when the album is long)… */
export const MAX_PHOTO_MS = 3000
/** …and at least this long; past that, photos are grouped into collages instead. */
export const MIN_PHOTO_MS = 2200
/** Videos play to the end, or this long at most, so clips don't take over the minute. */
export const VIDEO_MAX_S = 6
const MAX_PER_SCREEN = 4

const MOTIONS = ['kb-in-left', 'kb-out-right', 'kb-in-up', 'kb-out-down'] as const

const isPortrait = (m: FilmItem) => Boolean(m.width && m.height && m.height > m.width * 1.05)

function layoutFor(count: number, wideScreen: boolean): PhotoLayout {
  if (count === 1) return 'single'
  if (count === 2) return wideScreen ? 'pair-cols' : 'pair-rows'
  if (count === 3) return wideScreen ? 'trio-cols' : 'trio-rows'
  return 'quad'
}

/**
 * Turns the album into the film's screens, keeping the album's order:
 *  - two photos in a row that would each waste the screen (portraits on a wide screen, landscapes on
 *    an upright phone) share one screen;
 *  - if that still leaves too many screens for about a minute, photos are grouped into collages of
 *    up to four, as evenly as the minute needs;
 *  - each screen of photos shows for 2.2–3 s, videos for up to 6 s, the title card for 3 s.
 */
export function filmSlides(items: FilmItem[], opts: { wideScreen?: boolean } = {}): FilmSlide[] {
  const wide = opts.wideScreen ?? true
  const videoMs = items.filter((m) => m.video).reduce((sum, m) => sum + Math.min(m.duration ?? VIDEO_MAX_S, VIDEO_MAX_S) * 1000, 0)
  const photoBudget = Math.max(TARGET_MS - TITLE_MS - videoMs, MIN_PHOTO_MS)
  const maxScreens = Math.max(1, Math.floor(photoBudget / MIN_PHOTO_MS))

  // Runs of photos between videos, so a video always keeps its place in the story.
  const runs: Array<FilmItem[] | FilmItem> = []
  for (const m of items) {
    if (m.video) runs.push(m)
    else if (Array.isArray(runs.at(-1))) (runs.at(-1) as FilmItem[]).push(m)
    else runs.push([m])
  }
  const photoCount = items.filter((m) => !m.video).length

  // Natural screens: singles, with neighbours that would each waste the screen paired up.
  const wastes = (m: FilmItem) => (wide ? isPortrait(m) : !isPortrait(m))
  const natural = (run: FilmItem[]) => {
    const out: FilmItem[][] = []
    for (let i = 0; i < run.length; i++) {
      if (wastes(run[i]) && run[i + 1] && wastes(run[i + 1])) {
        out.push([run[i], run[i + 1]])
        i++
      } else out.push([run[i]])
    }
    return out
  }
  let groups = runs.map((r) => (Array.isArray(r) ? natural(r) : r))
  const screens = () => groups.reduce<number>((n, g) => n + (Array.isArray(g) ? g.length : 0), 0)
  if (screens() > maxScreens) {
    // Too long: even collages of up to four, sized for the minute.
    const perScreen = Math.min(MAX_PER_SCREEN, Math.ceil(photoCount / maxScreens))
    groups = runs.map((r) => {
      if (!Array.isArray(r)) return r
      const chunks: FilmItem[][] = []
      const n = Math.ceil(r.length / perScreen)
      // Spread evenly (4,4,3 rather than 4,4,4,1).
      for (let k = 0, at = 0; k < n; k++) {
        const size = Math.ceil((r.length - at) / (n - k))
        chunks.push(r.slice(at, at + size))
        at += size
      }
      return chunks
    })
  }
  const photoScreens = screens()
  const ms = photoScreens ? Math.round(Math.min(MAX_PHOTO_MS, Math.max(MIN_PHOTO_MS, photoBudget / photoScreens))) : MAX_PHOTO_MS

  const slides: FilmSlide[] = [{ kind: 'title', ms: TITLE_MS }]
  for (const g of groups) {
    if (!Array.isArray(g)) slides.push({ kind: 'video', item: g })
    else for (const screen of g) slides.push({ kind: 'photos', items: screen, layout: layoutFor(screen.length, wide), ms })
  }
  slides.push({ kind: 'end' })
  return slides
}

/** How long a slide stays on screen by itself; null when it decides (a video) or waits (the end). */
export function slideMs(slide: FilmSlide): number | null {
  return slide.kind === 'title' || slide.kind === 'photos' ? slide.ms : null
}

/** Roughly how long the film runs (videos at their capped length). */
export function filmLengthMs(slides: FilmSlide[]): number {
  return slides.reduce((t, s) => t + (s.kind === 'video' ? Math.min(s.item.duration ?? VIDEO_MAX_S, VIDEO_MAX_S) * 1000 : (slideMs(s) ?? 0)), 0)
}

/** startPaused: opened from a link rather than a click, so sound isn't allowed until the viewer presses Play. */
export function MemoryFilm({ items, info, onClose, startPaused = false }: { items: FilmItem[]; info: FilmInfo; onClose: () => void; startPaused?: boolean }) {
  // The screen's shape when the film opens decides how photos pair up (side by side, or stacked).
  const [wideScreen] = useState(() => typeof window === 'undefined' || window.innerWidth >= window.innerHeight)
  const slides = useMemo(() => filmSlides(items, { wideScreen }), [items, wideScreen])
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
    const ms = slideMs(slide)
    if (ms === null || paused) return
    const wait = left.current?.index === index ? left.current.ms : ms
    const started = performance.now()
    const id = window.setTimeout(() => go(index + 1), wait)
    return () => {
      window.clearTimeout(id)
      left.current = { index, ms: Math.max(0, wait - (performance.now() - started)) }
    }
  }, [slide, index, paused, go])

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
    if (next?.kind === 'photos') for (const m of next.items) new Image().src = m.url
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
  // Short screens need short fades; reduced motion fades a little more gently.
  const fadeMs = reduced ? 900 : 700
  const count = slides.length - 2
  const position = slide.kind === 'photos' || slide.kind === 'video' ? index : null

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
    if (s.kind === 'photos') {
      return (
        <div key={`photos-${s.items.map((m) => m.id).join('-')}`} className={`film-layer film-photos layout-${s.layout} ${state}`} style={style}>
          {s.items.map((m, k) => (
            <div key={m.id} className="film-cell">
              <img
                src={m.url}
                alt={i === index ? m.alt : ''}
                aria-hidden={i !== index}
                className={reduced ? '' : MOTIONS[(i + k) % MOTIONS.length]}
                style={{ objectPosition: `${(m.focalX ?? 0.5) * 100}% ${(m.focalY ?? 0.5) * 100}%`, animationDuration: `${s.ms + fadeMs * 2}ms` }}
                draggable={false}
              />
            </div>
          ))}
        </div>
      )
    }
    const item = s.item
    const objectPosition = `${(item.focalX ?? 0.5) * 100}% ${(item.focalY ?? 0.5) * 100}%`
    {
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
  }

  const current = slide.kind === 'video' ? slide.item : slide.kind === 'photos' ? (slide.items.find((m) => m.caption) ?? null) : null
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
