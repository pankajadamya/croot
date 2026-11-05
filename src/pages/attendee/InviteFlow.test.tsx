import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import InviteFlow from './InviteFlow'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('welcome separates the review choices, keeps the organiser note optional, and starts the story step', async () => {
  const view = {
    firstName: 'Some',
    editable: true,
    signIn: { required: false, signedIn: false, canReopen: false },
    retreat: {
      kind: 'itinerary',
      title: 'India Yoga & Pilates Retreat 2026',
      startDate: '2026-10-23',
      endDate: '2026-11-01',
      organiserName: 'Balance & Beyond',
      organisationName: 'Balance & Beyond',
      categories: [],
      privacyUrl: null,
      anonymousNotePath: '/api/anonymous/test',
      publicPagePath: null,
      privacyNoticePath: '/privacy',
      slideshow: [{ url: '/sunset.jpg', alt: 'Sunset over the retreat', caption: '' }],
      opening: { headline: 'From Delhi to the foothills', introParagraphs: ['A longer note from the organiser.'] },
      album: { unlocked: false, photoCount: 12, teaser: ['/album.jpg'], cover: null, note: null, url: null },
    },
    stay: null,
    response: null,
  }
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) => new Response(
    JSON.stringify(init?.method === 'PUT' ? { revision: 1, savedAt: '2026-11-05T10:00:00Z' } : view),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )))

  render(
    <MemoryRouter initialEntries={['/invite/test-token']}>
      <Routes><Route path="/invite/:token" element={<InviteFlow />} /></Routes>
    </MemoryRouter>,
  )

  expect(await screen.findByRole('heading', { name: 'Hello Some, how was your retreat?' })).toBeTruthy()
  for (const name of ['Your story', 'Private feedback', 'Anonymous note']) {
    expect(screen.getByRole('heading', { name })).toBeTruthy()
  }
  const note = screen.getByText('Read a note from Balance & Beyond').closest('details')
  expect(note?.open).toBe(false)
  fireEvent.click(screen.getByText('Read a note from Balance & Beyond'))
  expect(note?.open).toBe(true)
  expect(screen.queryByRole('button', { name: 'Hide photos' })).toBeNull()
  expect(screen.getByText(/public retreat album has 12 photos/)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Start review →' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Your story' })).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'Hide photos' })).toBeNull()
})
