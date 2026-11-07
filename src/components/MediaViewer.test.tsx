import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MediaViewer, type ViewerItem } from './MediaViewer'

afterEach(cleanup)

const items: ViewerItem[] = [
  { id: 'p1', url: '/m/p1/preview', alt: 'Sunrise over the hills', caption: 'Sunrise' },
  { id: 'v1', url: '/m/v1/preview', video: '/m/v1/video', alt: 'Waterfall', caption: 'Waterfall walk', note: 'Shared by a guest' },
]

function Harness({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  return <MediaViewer items={items} index={i} onIndex={setI} onClose={onClose} />
}

test('shows a photo full size, plays a video with its controls, moves with arrows and closes with Esc', () => {
  const onClose = vi.fn()
  const { container } = render(<Harness onClose={onClose} />)
  expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeTruthy()
  expect((screen.getByAltText('Sunrise over the hills') as HTMLImageElement).getAttribute('src')).toBe('/m/p1/preview')

  fireEvent.keyDown(document, { key: 'ArrowRight' })
  expect(screen.getByRole('dialog', { name: 'Video 2 of 2' })).toBeTruthy()
  const video = container.querySelector('video')!
  expect(video.getAttribute('src')).toBe('/m/v1/video')
  expect(video.controls).toBe(true)
  expect(video.autoplay).toBe(true)
  expect(screen.getByText('Waterfall walk · Shared by a guest')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})
