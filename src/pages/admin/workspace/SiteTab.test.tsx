import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SiteTab } from './SiteTab'
import type { Retreat } from '../types'
import { DEFAULT_THEME } from '../../../../shared/themes'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('page setup keeps an unsaved opening while switching sections and separates image and album controls', async () => {
  const retreat = {
    id: 'test-retreat', kind: 'itinerary', publicReviewsEnabled: true, showPublicRating: true,
    contactPublic: false, heroSlideshowEnabled: true, rewardAlbumEnabled: false,
    rewardAlbumUrl: null, rewardAlbumNote: '',
  } as Retreat
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    let body: unknown = {}
    if (path.endsWith('/content')) body = { draft: null, published: null }
    else if (path.endsWith('/theme')) body = { draft: null, published: null, fallback: DEFAULT_THEME }
    else if (path.endsWith('/media')) body = { media: [] }
    else if (path.endsWith('/album')) body = { media: [], coverId: null, pageUrl: null, usage: { photos: 0, videos: 0 }, limits: { maxPhotos: 50, maxVideos: 5 } }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><SiteTab orgSlug="balance-and-beyond" retreat={retreat} /></QueryClientProvider>)

  const headline = await screen.findByRole('textbox', { name: 'Headline' })
  fireEvent.change(headline, { target: { value: 'A new opening' } })
  fireEvent.click(screen.getByRole('button', { name: 'Visitor visibility' }))
  expect(screen.getByRole('heading', { name: 'What visitors see' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Slideshow images' }))
  expect(screen.getByText(/Every photo in that slideshow also appears beside the guest/)).toBeTruthy()
  expect(screen.queryByRole('switch', { name: /beside the guest/i })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Photo album/ }))
  expect(screen.getByRole('button', { name: 'Make album available' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Opening/ }))
  expect((screen.getByRole('textbox', { name: 'Headline' }) as HTMLInputElement).value).toBe('A new opening')
})
