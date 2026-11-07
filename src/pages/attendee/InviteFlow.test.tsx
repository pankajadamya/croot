import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import InviteFlow from './InviteFlow'
import { ConfirmProvider } from '../../components/ConfirmDialog'

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

test('leaving the permissions step with a story but nothing shared asks once, with equal answers', async () => {
  const view = {
    firstName: 'Adamya',
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
      slideshow: [],
      opening: null,
      album: { unlocked: false, photoCount: 0, teaser: [], cover: null, note: null, url: null },
      albumSharingAvailable: true,
    },
    stay: null,
    response: {
      status: 'draft',
      revision: 3,
      currentStep: 4,
      storyTitle: 'Mornings',
      storyText: 'The sunrise yoga was the best part.',
      overallRating: 5,
      keepText: '',
      changeText: '',
      consents: { publicText: false, firstName: false, followUp: false, marketing: false, photoMarketing: null },
      ratings: [],
      photos: [],
      submittedAt: null,
      organiserMessage: null,
    },
  }
  const puts: Array<{ consents: { publicText: boolean; marketing: boolean } }> = []
  vi.stubGlobal('scrollTo', vi.fn())
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify(init?.method === 'PUT' ? { revision: 4, savedAt: '2026-11-05T10:00:00Z' } : view), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))

  const ui = () => (
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/invite/test-token']}>
        <Routes><Route path="/invite/:token" element={<InviteFlow />} /></Routes>
      </MemoryRouter>
    </ConfirmProvider>
  )

  // "No": carries on to Review & send, with nothing shared.
  render(ui())
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
  expect(await screen.findByRole('heading', { name: 'Share your story?' })).toBeTruthy()
  const answers = ['Yes, publish it and allow social media & advertising', 'Yes, publish it on the review site only', 'No, keep it private'].map((name) => screen.getByRole('button', { name }))
  expect(new Set(answers.map((b) => b.className)).size).toBe(1) // equal answers
  fireEvent.click(answers[2])
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Review and send' })).toBeTruthy())
  expect(puts.at(-1)?.consents).toMatchObject({ publicText: false, marketing: false })
  cleanup()

  // "Yes, … social media & advertising": both switched on; the guest stays to see it (and choose about their name).
  render(ui())
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Yes, publish it and allow social media & advertising' }))
  expect(await screen.findByText(/published once it’s approved, and may be reused in social media/)).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Photos & permissions' })).toBeTruthy()
  // No second question: Review now moves on.
  fireEvent.click(screen.getByRole('button', { name: 'Review' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Review and send' })).toBeTruthy())
  expect(puts.at(-1)?.consents).toMatchObject({ publicText: true, marketing: true })
  cleanup()

  // "Yes, … review site only": publishing only.
  render(ui())
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Yes, publish it on the review site only' }))
  await waitFor(() => expect(document.querySelector('.permissions-words .notice')).toBeTruthy())
  expect(document.querySelector('.permissions-words .notice')!.textContent!.replace(/\s+/g, ' ')).toBe(
    'Thank you. Your story will be published once it’s approved. Choose below whether to show your first name, then press Review.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Review' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Review and send' })).toBeTruthy())
  expect(puts.at(-1)?.consents).toMatchObject({ publicText: true, marketing: false })
})

test('a guest who comes back straight to Review & send, with a story and nothing shared, is asked at Send', async () => {
  const view = {
    firstName: 'Adamya',
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
      slideshow: [],
      opening: null,
      album: { unlocked: false, photoCount: 0, teaser: [], cover: null, note: null, url: null },
      albumSharingAvailable: true,
    },
    stay: null,
    response: {
      status: 'draft',
      revision: 3,
      currentStep: 5, // left last time on Review & send
      storyTitle: 'Mornings',
      storyText: 'The sunrise yoga was the best part.',
      overallRating: 5,
      keepText: '',
      changeText: '',
      consents: { publicText: false, firstName: false, followUp: false, marketing: false, photoMarketing: null },
      ratings: [],
      photos: [],
      submittedAt: null,
      organiserMessage: null,
    },
  }
  const puts: Array<{ consents: { publicText: boolean; marketing: boolean } }> = []
  const submits: string[] = []
  vi.stubGlobal('scrollTo', vi.fn())
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)))
    if (init?.method === 'POST' && String(path).endsWith('/submit')) {
      submits.push(String(path))
      return new Response(JSON.stringify({ receiptToken: 'receipt-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify(init?.method === 'PUT' ? { revision: 4, savedAt: '2026-11-05T10:00:00Z' } : view), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const ui = () => (
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/invite/test-token']}>
        <Routes>
          <Route path="/invite/:token" element={<InviteFlow />} />
          <Route path="/response/:token" element={<h1>Receipt page</h1>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  )

  // "No, keep it private": sent straight away, nothing shared.
  render(ui())
  expect(await screen.findByRole('heading', { name: 'Review and send' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Send my response' }))
  expect(await screen.findByRole('heading', { name: 'Share your story?' })).toBeTruthy()
  expect(submits).toHaveLength(0) // nothing sent before the guest answers
  fireEvent.click(screen.getByRole('button', { name: 'No, keep it private' }))
  expect(await screen.findByRole('heading', { name: 'Receipt page' })).toBeTruthy()
  expect(submits).toHaveLength(1)
  expect(puts.at(-1)?.consents).toMatchObject({ publicText: false, marketing: false })
  cleanup()
  submits.length = 0

  // "Yes, … review site only": not sent yet; the guest stays on Review & send and sees the preview,
  // then Send goes through without asking again.
  render(ui())
  expect(await screen.findByRole('heading', { name: 'Review and send' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Send my response' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Yes, publish it on the review site only' }))
  expect(await screen.findByText('Preview, if the organiser approves it')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Review and send' })).toBeTruthy()
  expect(submits).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Send my response' }))
  expect(await screen.findByRole('heading', { name: 'Receipt page' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Share your story?' })).toBeNull()
  expect(submits).toHaveLength(1)
  expect(puts.at(-1)?.consents).toMatchObject({ publicText: true, marketing: false })
})
