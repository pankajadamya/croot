import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { filmLengthMs, filmScreen, filmSlides, MemoryFilm, MOVING_SCREEN_MS, SCREEN_MS, slideMs, STILL_SCREEN_MS, TARGET_MS, TITLE_MS, type FilmItem } from './MemoryFilm'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const photo = (id: string, caption = ''): FilmItem => ({ id, url: `/p/${id}`, alt: `Photo ${id}`, caption, video: null, duration: null })
const clip: FilmItem = { id: 'v1', url: '/p/v1', alt: 'Waterfall video', caption: '', video: '/v/v1', duration: 12 }
const info = { title: 'India Retreat 2026', organiser: 'Balance & Beyond', startDate: '2026-10-23', endDate: '2026-11-01', music: 'none' as const }

test('plays the album in its order between a title card and a closing card', () => {
  const slides = filmSlides([photo('a'), clip, photo('b')])
  expect(slides.map((s) => (s.kind === 'photos' ? `photos:${s.items.map((m) => m.id).join('+')}` : s.kind === 'video' ? `video:${s.item.id}` : s.kind))).toEqual(['title', 'photos:a', 'video:v1', 'photos:b', 'end'])
  expect(slideMs(slides[0])).toBe(TITLE_MS)
  // The same unhurried pace for every screen; a little longer with reduced motion.
  expect(slideMs(slides[1])).toBe(SCREEN_MS)
  expect(slideMs(filmSlides([photo('a')], { reduced: true })[1])).toBe(STILL_SCREEN_MS)
  // Videos decide their own length (capped); the end waits.
  expect(slideMs(slides[2])).toBeNull()
  expect(slideMs(slides[4])).toBeNull()
})

test('two portraits share a wide screen; two landscapes share an upright phone', () => {
  const portrait = (id: string) => ({ ...photo(id), width: 900, height: 1600 })
  const landscape = (id: string) => ({ ...photo(id), width: 1600, height: 900 })
  const wide = filmSlides([portrait('p1'), portrait('p2'), landscape('l1'), portrait('p3')], { wideScreen: true })
  expect(wide.filter((s) => s.kind === 'photos').map((s) => s.kind === 'photos' && `${s.layout}:${s.items.length}`)).toEqual(['pair-cols:2', 'single:1', 'single:1'])
  const phone = filmSlides([landscape('l1'), landscape('l2'), portrait('p1')], { wideScreen: false })
  expect(phone.filter((s) => s.kind === 'photos').map((s) => s.kind === 'photos' && `${s.layout}:${s.items.length}`)).toEqual(['pair-rows:2', 'single:1'])
})

test('an ordinary album plays every photo on its own; only a long one becomes collages', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => photo(`s${i}`))
  expect(filmSlides(twenty).filter((s) => s.kind === 'photos' && s.items.length > 1)).toEqual([])

  const many = Array.from({ length: 90 }, (_, i) => photo(`p${i}`))
  const slides = filmSlides(many)
  const screens = slides.filter((s) => s.kind === 'photos')
  expect(screens.every((s) => s.kind === 'photos' && s.items.length <= 5 && s.ms === SCREEN_MS)).toBe(true)
  expect(screens.flatMap((s) => (s.kind === 'photos' ? s.items.map((m) => m.id) : []))).toEqual(many.map((m) => m.id)) // every photo, in order
  expect(filmLengthMs(slides)).toBeLessThanOrEqual(TARGET_MS)
  // Varied: photos on their own, pairs, threes and fours, some overlapping; never the same collage size twice running.
  const sizes = screens.map((s) => (s.kind === 'photos' ? s.items.length : 0))
  for (const n of [1, 2, 3, 4]) expect(sizes).toContain(n)
  expect(sizes.every((n, i) => i === 0 || n === 1 || n !== sizes[i - 1])).toBe(true)
  const layouts = new Set(screens.map((s) => s.kind === 'photos' && s.layout))
  expect(layouts.has('scatter')).toBe(true)
  expect(screens.every((s) => s.kind !== 'photos' || s.items.length < 5 || s.layout === 'scatter')).toBe(true)
})

test('a very large album still mixes sizes instead of all fours', () => {
  const lots = Array.from({ length: 200 }, (_, i) => photo(`q${i}`))
  const sizes = filmSlides(lots).flatMap((s) => (s.kind === 'photos' ? [s.items.length] : []))
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(200)
  expect(sizes.filter((n) => n === 4).length / sizes.length).toBeLessThan(0.4)
  expect(sizes.filter((n) => n <= 2).length).toBeGreaterThan(5)
})

test('moves on by itself, can be paused and skipped, and closes with Esc', () => {
  vi.useFakeTimers()
  const onClose = vi.fn()
  render(<MemoryFilm items={[photo('a', 'Sunrise yoga'), photo('b')]} info={info} onClose={onClose} />)
  expect(screen.getByRole('dialog', { name: 'Memory film: India Retreat 2026' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'India Retreat 2026' })).toBeTruthy()
  expect(screen.getByText('with Balance & Beyond')).toBeTruthy()

  act(() => vi.advanceTimersByTime(TITLE_MS + 10))
  expect(screen.getByText('Sunrise yoga')).toBeTruthy()
  expect(screen.getByText('1 / 2')).toBeTruthy()

  // Paused, it stays put however long it waits.
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  act(() => vi.advanceTimersByTime(SCREEN_MS * 3))
  expect(screen.getByText('1 / 2')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))

  fireEvent.keyDown(document, { key: 'ArrowRight' })
  expect(screen.getByText('2 / 2')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Thank you for the memories' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Watch again' })).toBeTruthy()

  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('opened from a link it waits for Play (browsers allow sound only after a click)', () => {
  vi.useFakeTimers()
  render(<MemoryFilm items={[photo('a')]} info={info} onClose={() => undefined} startPaused />)
  act(() => vi.advanceTimersByTime(TITLE_MS * 3))
  expect(screen.getByRole('heading', { name: 'India Retreat 2026' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
})

test('"One at a time" and "Moving" give every photo its own screen, however long the album', () => {
  const portrait = (id: string): FilmItem => ({ ...photo(id), width: 600, height: 900 })
  const lots = [portrait('a'), ...Array.from({ length: 120 }, (_, i) => photo(`r${i}`))]
  const single = filmSlides(lots, { style: 'single' }).filter((s) => s.kind === 'photos')
  expect(single).toHaveLength(121)
  expect(single.every((s) => s.kind === 'photos' && s.items.length === 1 && s.ms === SCREEN_MS && !s.motion)).toBe(true)
  // A portrait on a wide screen is shown whole over a blurred copy.
  expect(single[0].kind === 'photos' && single[0].fit).toBe(true)

  const moving = filmSlides(lots, { style: 'dynamic' }).filter((s) => s.kind === 'photos')
  expect(moving).toHaveLength(121)
  expect(moving.every((s) => s.kind === 'photos' && s.ms === MOVING_SCREEN_MS && s.motion && !s.fit)).toBe(true)
  expect(moving[0].kind === 'photos' && moving[0].motion).toBe('pan-down') // along the portrait
  expect(new Set(moving.map((s) => s.kind === 'photos' && s.motion)).size).toBeGreaterThan(4)
  // Reduced motion: still photos.
  expect(filmSlides(lots, { style: 'dynamic', reduced: true }).every((s) => s.kind !== 'photos' || !s.motion)).toBe(true)
})

test('in a collage each photo carries its own caption, inside its own cell', () => {
  vi.useFakeTimers()
  const lots = Array.from({ length: 80 }, (_, i) => photo(`c${i}`, `Caption ${i}`))
  const { container } = render(<MemoryFilm items={lots} info={info} onClose={() => undefined} startPaused />)
  for (let step = 0; step < 6; step++) {
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    const active = container.querySelector('.film-layer.active')!
    const cells = [...active.querySelectorAll('.film-cell')]
    if (cells.length < 2) continue
    for (const cell of cells) {
      const id = cell.querySelector('img')!.getAttribute('src')!.split('/').pop()!.slice(1)
      expect(cell.querySelector('.film-cell-caption')?.textContent).toBe(`Caption ${id}`)
    }
    // No screen-wide caption for a collage, which could be read as any of its photos'.
    expect(container.querySelector('.film-caption')).toBeNull()
  }
})

test('on a phone photos are never small: up to three stacked upright, two side by side turned, no overlapping prints', () => {
  const lots = Array.from({ length: 150 }, (_, i) => photo(`m${i}`))
  const upright = filmSlides(lots, { screen: filmScreen(390, 844) }).flatMap((s) => (s.kind === 'photos' ? [s] : []))
  expect(Math.max(...upright.map((s) => s.items.length))).toBe(3)
  expect(new Set(upright.map((s) => s.layout))).toEqual(new Set(['single', 'pair-rows', 'trio-rows']))
  const turned = filmSlides(lots, { screen: filmScreen(844, 390) }).flatMap((s) => (s.kind === 'photos' ? [s] : []))
  expect(Math.max(...turned.map((s) => s.items.length))).toBe(2)
  expect(new Set(turned.map((s) => s.layout))).toEqual(new Set(['single', 'pair-cols']))
  // Every photo is still in the film, in order; it just runs longer than on a laptop.
  expect(upright.flatMap((s) => s.items.map((m) => m.id))).toEqual(lots.map((m) => m.id))
  const laptop = filmSlides(lots, { screen: filmScreen(1440, 900) })
  expect(filmLengthMs(filmSlides(lots, { screen: filmScreen(390, 844) }))).toBeGreaterThan(filmLengthMs(laptop))
  expect(Math.max(...laptop.flatMap((s) => (s.kind === 'photos' ? [s.items.length] : [])))).toBe(5)
  // An upright tablet: up to four; a 1366 × 768 laptop keeps the full mix.
  expect(Math.max(...filmSlides(lots, { screen: filmScreen(1366, 768) }).flatMap((s) => (s.kind === 'photos' ? [s.items.length] : [])))).toBe(5)
  expect(Math.max(...filmSlides(lots, { screen: filmScreen(820, 1180) }).flatMap((s) => (s.kind === 'photos' ? [s.items.length] : [])))).toBe(4)
})

test('turning the phone lays the film out again and carries on from the same photo', () => {
  vi.useFakeTimers()
  const lots = Array.from({ length: 150 }, (_, i) => photo(`t${i}`))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  const { container } = render(<MemoryFilm items={lots} info={info} onClose={() => undefined} startPaused />)
  for (let i = 0; i < 6; i++) fireEvent.keyDown(document, { key: 'ArrowRight' })
  const shown = () => [...container.querySelectorAll('.film-layer.active .film-cell img')].map((img) => img.getAttribute('src'))
  const before = shown()
  expect(before.length).toBeLessThanOrEqual(3)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 844 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 })
  act(() => {
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(250)
  })
  const after = shown()
  expect(after.length).toBeLessThanOrEqual(2)
  expect(after).toContain(before[0])
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

test('on a phone or tablet the film goes full screen when opened with a tap (from a link: at Play), and leaves it when closed', () => {
  const request = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this })
    return Promise.resolve()
  })
  const exit = vi.fn(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    return Promise.resolve()
  })
  const originalMatch = window.matchMedia
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  try {
    const tapped = render(<MemoryFilm items={[photo('a')]} info={info} onClose={() => undefined} />)
    expect(request).toHaveBeenCalledTimes(1)
    tapped.unmount()
    expect(exit).toHaveBeenCalledTimes(1)

    render(<MemoryFilm items={[photo('a')]} info={info} onClose={() => undefined} startPaused />)
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(request).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeTruthy()
  } finally {
    window.matchMedia = originalMatch
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  }
})
