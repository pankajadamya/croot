import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { storage } from '../src/lib/storage.js'
import { login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

/** A JPEG as a phone writes it: when it was taken (with the time zone) and where. */
const phonePhoto = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a9a8a' } })
    .withExif({
      IFD0: { Make: 'Phone', Model: 'Phone 15', DateTime: '2026:10:25 07:00:00' },
      IFD2: { DateTimeOriginal: '2026:10:24 05:52:28', OffsetTimeOriginal: '+05:30' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '32/1 6/1 0/1' },
    })
    .jpeg()
    .toBuffer()

describe('time taken', () => {
  it('keeps when a photo was taken, and nothing else from its metadata', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const up = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media?album=1`).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').attach('image', await phonePhoto(), 'IMG_1.jpg')
    expect(up.status).toBe(201)
    expect(up.body.media.takenAt).toBe('2026-10-24T00:22:28.000Z')

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.body.media.id } })
    expect(row.originalKey).toBeNull() // only the web copy is stored
    const meta = await sharp((await storage.get(row.derivativeKey))!).metadata()
    expect(meta.exif).toBeUndefined()
  })

  it('uses the browser’s reading when the file lost its EXIF (a converted iPhone photo), if it is sensible', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    let width = 64
    const send = async (takenAt: string) => agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media?album=1`).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').field('takenAt', takenAt).attach('image', await sharp({ create: { width: width++, height: 48, channels: 3, background: '#335544' } }).jpeg().toBuffer(), 'converted.jpg')
    expect((await send('2026-10-28T09:13:15.000Z')).body.media.takenAt).toBe('2026-10-28T09:13:15.000Z')
    expect((await send('2199-01-01T00:00:00Z')).body.media.takenAt).toBeNull()
    expect((await send('')).body.media.takenAt).toBeNull()
  })
})
