import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { imageQueueState, processImage } from '../src/lib/images.js'

describe('photo processing queue', () => {
  it('processes at most two photos at once; the rest wait and all finish', async () => {
    const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#7a9a8a' } }).jpeg().toBuffer()
    let peak = 0
    const timer = setInterval(() => (peak = Math.max(peak, imageQueueState().running)), 1)
    const jobs = Array.from({ length: 6 }, () => processImage(photo))
    expect(imageQueueState()).toEqual({ running: 2, waiting: 4 })
    const results = await Promise.all(jobs)
    clearInterval(timer)
    expect(peak).toBeLessThanOrEqual(2)
    expect(results).toHaveLength(6)
    expect(results.every((r) => r.width === 2560)).toBe(true)
    expect(imageQueueState()).toEqual({ running: 0, waiting: 0 })
  })

  it('frees its slot when a photo is rejected', async () => {
    await expect(processImage(Buffer.from('not an image'))).rejects.toThrow()
    expect(imageQueueState()).toEqual({ running: 0, waiting: 0 })
  })
})
