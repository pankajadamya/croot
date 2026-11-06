import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { filmSlides, MemoryFilm, PHOTO_MS, slideMs, STILL_PHOTO_MS, TITLE_MS, type FilmItem } from './MemoryFilm'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const photo = (id: string, caption = ''): FilmItem => ({ id, url: `/p/${id}`, alt: `Photo ${id}`, caption, video: null, duration: null })
const clip: FilmItem = { id: 'v1', url: '/p/v1', alt: 'Waterfall video', caption: '', video: '/v/v1', duration: 12 }
const info = { title: 'India Retreat 2026', organiser: 'Balance & Beyond', startDate: '2026-10-23', endDate: '2026-11-01', music: 'none' as const }

test('plays the album in its order between a title card and a closing card', () => {
  const slides = filmSlides([photo('a'), clip, photo('b')])
  expect(slides.map((s) => (s.kind === 'photo' || s.kind === 'video' ? `${s.kind}:${s.item.id}` : s.kind))).toEqual(['title', 'photo:a', 'video:v1', 'photo:b', 'end'])
  expect(slideMs(slides[0], false)).toBe(TITLE_MS)
  expect(slideMs(slides[1], false)).toBe(PHOTO_MS)
  // Reduced motion: photos hold still a little longer; videos decide their own length; the end waits.
  expect(slideMs(slides[1], true)).toBe(STILL_PHOTO_MS)
  expect(slideMs(slides[2], false)).toBeNull()
  expect(slideMs(slides[4], false)).toBeNull()
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
  act(() => vi.advanceTimersByTime(PHOTO_MS * 3))
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
