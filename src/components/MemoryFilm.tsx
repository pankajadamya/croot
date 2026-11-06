import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FilmMusic, FilmStyle } from '../../shared/film'
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
  /** Who took it ("Photo: …"), shown with a photo that has the screen to itself. */
  credit?: string | null
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
  /** How the photos are shown (shared/film.ts); a mix when not given. */
  style?: FilmStyle
}

/**
 * How a screen of photos is laid out: one; two side by side or stacked; one large and two small; four in
 * a grid; one large and three small (feature); or three to five slightly overlapping prints (scatter).
 * `flip` mirrors the arrangement, so the large photo isn't always on the same side.
 */
export type PhotoLayout = 'single' | 'pair-cols' | 'pair-rows' | 'trio-cols' | 'trio-rows' | 'quad' | 'feature' | 'scatter'

export type FilmSlide =
  | { kind: 'title'; ms: number }
  | {
      kind: 'photos'
      items: FilmItem[]
      layout: PhotoLayout
      flip: boolean
      ms: number
      /** The "Moving" style's camera move for this photo (a `film-move-*` animation), instead of the gentle zoom. */
      motion?: string
      /** Show the whole photo over a blurred copy of itself, rather than filling the screen. */
      fit?: boolean
    }
  | { kind: 'video'; item: FilmItem }
  | { kind: 'end' }

/** Past about this long, photos are grouped into collages so a big album doesn't drag on. */
export const TARGET_MS = 180_000
export const TITLE_MS = 4500
/** Each screen of photos, at an unhurried pace with a slow zoom… */
export const SCREEN_MS = 6000
/** …and a little longer with reduced motion, when nothing moves. */
export const STILL_SCREEN_MS = 7000
/** Videos play to the end, or this long at most, so one long clip doesn't take over the film. */
export const VIDEO_MAX_S = 15
/** Five photos only ever appear as overlapping prints. */
const MAX_PER_SCREEN = 5
/**
 * In a long album, screens hold about this many photos at most on average, so photos on their own and
 * pairs keep appearing (a very big album plays a little longer instead of becoming all fours and fives).
 */
const MAX_AVERAGE = 3.2

/** A small seeded random generator, so an album's film comes out the same every time it's played. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The next screen's size: picked at random around the average still needed, never the same collage
 * size as the last one, and within what the remaining screens can absorb. Five (overlapping prints) is rarer.
 */
function nextSize(target: number, lo: number, hi: number, previous: number, random: () => number): number {
  // A tighter spread near one photo a screen, so early large screens don't leave a tail of singles.
  const spread = 2.6 * Math.min(1, Math.max(0.3, (target - 0.8) / 1.6))
  const options: Array<[number, number]> = []
  for (let s = lo; s <= hi; s++) {
    if (s === previous && s > 1 && hi > lo) continue // photos on their own may follow each other
    options.push([s, Math.exp(-((s - target) ** 2) / spread) * (s === 5 ? 0.45 : 1)])
  }
  let r = random() * options.reduce((sum, [, w]) => sum + w, 0)
  for (const [s, w] of options) if ((r -= w) <= 0) return s
  return options.at(-1)![0]
}

const MOTIONS = ['kb-in-left', 'kb-out-right', 'kb-in-up', 'kb-out-down'] as const
/** The "Moving" style's camera moves, in turn, for photos that match the screen's shape. */
const MOVES = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left', 'zoom-in-up', 'pan-down-wide'] as const
/** Each photo's time in the "Moving" style. */
export const MOVING_SCREEN_MS = 5000

const isPortrait = (m: FilmItem) => Boolean(m.width && m.height && m.height > m.width * 1.05)

/** The layout for the nth screen of this many photos: trios and fours take turns between their arrangements. */
function layoutFor(count: number, wideScreen: boolean, nth = 0): { layout: PhotoLayout; flip: boolean } {
  const flip = nth % 2 === 1
  if (count === 1) return { layout: 'single', flip: false }
  if (count === 2) return { layout: wideScreen ? 'pair-cols' : 'pair-rows', flip: false }
  if (count === 3) return nth % 3 === 2 ? { layout: 'scatter', flip } : { layout: wideScreen ? 'trio-cols' : 'trio-rows', flip }
  if (count === 4) return { layout: (['quad', 'scatter', 'feature'] as const)[nth % 3], flip: Math.floor(nth / 3) % 2 === 1 }
  return { layout: 'scatter', flip }
}

/**
 * Turns the album into the film's screens, keeping the album's order:
 *  - two photos in a row that would each waste the screen (portraits on a wide screen, landscapes on
 *    an upright phone) share one screen;
 *  - if the film would still run past about three minutes, photos are grouped into collages of one to
 *    five, varied in size and arrangement (five only as overlapping prints);
 *  - each screen shows for 6 s (7 s with reduced motion), videos for up to 15 s, the title for 4.5 s.
 */
export function filmSlides(items: FilmItem[], opts: { wideScreen?: boolean; reduced?: boolean; style?: FilmStyle } = {}): FilmSlide[] {
  const wide = opts.wideScreen ?? true
  if (opts.style === 'single' || opts.style === 'dynamic') return oneByOne(items, wide, opts.style === 'dynamic' && !opts.reduced, Boolean(opts.reduced))
  const screenMs = opts.reduced ? STILL_SCREEN_MS : SCREEN_MS
  const videoMs = items.filter((m) => m.video).reduce((sum, m) => sum + Math.min(m.duration ?? VIDEO_MAX_S, VIDEO_MAX_S) * 1000, 0)
  const photoBudget = Math.max(TARGET_MS - TITLE_MS - videoMs, screenMs)
  const maxScreens = Math.max(1, Math.floor(photoBudget / screenMs))

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
    // Too long: collages of varied sizes (a photo on its own, then three, two, four, five
    // overlapping…), averaging what fits the length, and never the same size twice in a row.
    const average = Math.min(MAX_AVERAGE, photoCount / maxScreens)
    const random = seeded(photoCount * 7919 + 17)
    let previous = 0
    groups = runs.map((r) => {
      if (!Array.isArray(r)) return r
      const chunks: FilmItem[][] = []
      const n = Math.min(r.length, Math.max(Math.ceil(r.length / MAX_PER_SCREEN), Math.floor(r.length / average)))
      for (let k = 0, at = 0; k < n; k++) {
        const left = r.length - at
        const screensLeft = n - k
        const lo = Math.max(1, left - (screensLeft - 1) * MAX_PER_SCREEN)
        const hi = Math.min(MAX_PER_SCREEN, left - (screensLeft - 1))
        const size = nextSize(left / screensLeft, lo, hi, previous, random)
        chunks.push(r.slice(at, at + size))
        at += size
        previous = size
      }
      // The last screens can be forced to a size; where two neighbours match, move a photo across.
      for (let k = 1; k < chunks.length; k++) {
        const [a, b] = [chunks[k - 1], chunks[k]]
        if (a.length !== b.length || a.length <= 1 || b.length >= MAX_PER_SCREEN) continue
        const moved = a.length - 1
        if (chunks[k - 2]?.length === moved || chunks[k + 1]?.length === b.length + 1) continue
        chunks[k - 1] = a.slice(0, -1)
        chunks[k] = [a.at(-1)!, ...b]
      }
      return chunks
    })
  }
  const ms = screenMs

  const slides: FilmSlide[] = [{ kind: 'title', ms: TITLE_MS }]
  const seen: Record<number, number> = {}
  for (const g of groups) {
    if (!Array.isArray(g)) slides.push({ kind: 'video', item: g })
    else
      for (const screen of g) {
        const nth = (seen[screen.length] = (seen[screen.length] ?? -1) + 1)
        slides.push({ kind: 'photos', items: screen, ms, ...layoutFor(screen.length, wide, nth) })
      }
  }
  slides.push({ kind: 'end' })
  return slides
}

/**
 * The "One at a time" and "Moving" styles: every photo has the screen to itself, however long the album.
 *  - One at a time: the whole photo is shown (a portrait on a wide screen, or a landscape on an upright
 *    phone, sits over a soft blurred copy of itself) with the usual gentle zoom, 6 s each.
 *  - Moving: the photo fills the screen and the camera moves more: zooming in or out, or panning across
 *    it, and along the hidden part of a photo that doesn't match the screen's shape. 5 s each.
 * With reduced motion, Moving plays like One at a time, still.
 */
function oneByOne(items: FilmItem[], wide: boolean, moving: boolean, reduced: boolean): FilmSlide[] {
  const slides: FilmSlide[] = [{ kind: 'title', ms: TITLE_MS }]
  const ms = moving ? MOVING_SCREEN_MS : reduced ? STILL_SCREEN_MS : SCREEN_MS
  // Separate turns for photos that match the screen and those that don't, so pans along portraits alternate.
  let matched = 0
  let other = 0
  for (const m of items) {
    if (m.video) {
      slides.push({ kind: 'video', item: m })
      continue
    }
    const mismatched = wide ? isPortrait(m) : !isPortrait(m) && Boolean(m.width && m.height)
    const motion = !moving ? undefined : mismatched ? (wide ? ['pan-down', 'pan-up'] : ['pan-across', 'pan-back'])[other++ % 2] : MOVES[matched++ % MOVES.length]
    slides.push({ kind: 'photos', items: [m], layout: 'single', flip: false, ms, motion, fit: !moving && mismatched })
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
  const [reduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const slides = useMemo(() => filmSlides(items, { wideScreen, reduced, style: info.style }), [items, wideScreen, reduced, info.style])
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
  // Slow crossfades; gentler still with reduced motion.
  const fadeMs = reduced ? 1600 : 1200
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
        <div key={`photos-${s.items.map((m) => m.id).join('-')}`} className={`film-layer film-photos layout-${s.layout} n-${s.items.length} ${s.flip ? 'is-flipped' : ''} ${state}`} style={style}>
          {s.items.map((m, k) => (
            <div key={m.id} className={`film-cell ${s.fit ? 'is-fit' : ''}`} style={s.layout === 'scatter' && !reduced ? { animationDelay: `${fadeMs / 2 + k * 450}ms` } : undefined}>
              {s.fit && <img className="film-fit-bg" src={m.url} alt="" aria-hidden="true" draggable={false} />}
              <img
                src={m.url}
                alt={i === index ? m.alt : ''}
                aria-hidden={i !== index}
                className={reduced ? '' : s.motion ? `film-move-${s.motion}` : MOTIONS[(i + k) % MOTIONS.length]}
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

  const current = slide.kind === 'video' ? slide.item : slide.kind === 'photos' ? (slide.items.length === 1 ? slide.items[0] : (slide.items.find((m) => m.caption) ?? null)) : null
  // Credits only where one photo has the screen; a collage would need a list.
  const credit = slide.kind === 'photos' && slide.items.length === 1 ? slide.items[0].credit : slide.kind === 'video' ? slide.item.credit : null
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

      {(current?.caption || credit) && (
        <p className="film-caption">
          {current?.caption && shortCaption(current.caption, 110)}
          {credit && <span className="film-credit">Photo: {credit}</span>}
        </p>
      )}

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
