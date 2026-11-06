import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { filmLengthMs, filmSlides, MemoryFilm, SCREEN_MS, slideMs, STILL_SCREEN_MS, TARGET_MS, TITLE_MS, type FilmItem } from './MemoryFilm'

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
