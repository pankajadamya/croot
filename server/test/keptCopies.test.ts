import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { runRetention } from '../src/jobs/retention.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { storage } from '../src/lib/storage.js'
import { makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

describe('private 4K copies from before v1.5', () => {
  it('are deleted, leaving the web copy (whose size the photo now records); videos keep their file', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const base = { organisationId: org.id, retreatId: retreat.id, width: 10, height: 10 }
    await storage.put('old/original', Buffer.alloc(5000), 'image/jpeg')
    await storage.put('old/web.webp', Buffer.alloc(700), 'image/webp')
    const photo = await prisma.mediaAsset.create({
      data: { ...base, kind: 'album', originalKey: 'old/original', derivativeKey: 'old/web.webp', mime: 'image/jpeg', sizeBytes: 5000 },
    })
    await storage.put('vid/video.mp4', Buffer.alloc(900), 'video/mp4')
    const video = await prisma.mediaAsset.create({
      data: { ...base, kind: 'album', originalKey: 'vid/video.mp4', videoKey: 'vid/video.mp4', derivativeKey: 'vid/poster.webp', mime: 'video/mp4', sizeBytes: 900 },
    })

    const counts = await runRetention()
    expect(counts.originals).toBe(1)
    expect(await storage.get('old/original')).toBeNull()
    expect(await storage.size('old/web.webp')).toBe(700)
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ originalKey: null, sizeBytes: 700, mime: 'image/webp' })
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ originalKey: 'vid/video.mp4', sizeBytes: 900 })
    expect(await storage.size('vid/video.mp4')).toBe(900)

    expect((await runRetention()).originals).toBe(0) // done once
  })
})
