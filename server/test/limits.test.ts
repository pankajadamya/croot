import sharp from 'sharp'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { processImage } from '../src/lib/images.js'
import { hashPassword } from '../src/lib/password.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a9a8a' } }).png().toBuffer()

describe('album limits', () => {
  it('defaults to 50 photos and 5 videos, can be changed by an admin only, and is enforced', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const albumApi = `/api/admin/orgs/alpha/retreats/${retreat.id}`

    const first = await agent.get(`${albumApi}/album`)
    expect(first.body.limits).toEqual({ maxPhotos: 50, maxVideos: 5 })
    expect(first.body.usage).toEqual({ photos: 0, videos: 0 })

    // Organisers can't change the limits.
    expect((await agent.patch('/api/platform/settings').set('X-CSRF-Token', csrf).send({ albumMaxPhotos: 500 })).status).toBe(403)

    const admin = await prisma.user.create({ data: { email: 'ops@croot.test', name: 'Ops', isPlatformAdmin: true, passwordHash: await hashPassword('correct horse battery') } })
    const ops = await login(admin.email)
    expect((await ops.agent.get('/api/platform/settings')).body.settings).toMatchObject({ albumMaxPhotos: 50, albumMaxVideos: 5 })
    expect((await ops.agent.patch('/api/platform/settings').set('X-CSRF-Token', ops.csrf).send({ albumMaxPhotos: 0 })).status).toBe(400)
    const changed = await ops.agent.patch('/api/platform/settings').set('X-CSRF-Token', ops.csrf).send({ albumMaxPhotos: 2, albumMaxVideos: 1 })
    expect(changed.body.settings).toMatchObject({ albumMaxPhotos: 2, albumMaxVideos: 1 })

    // A slideshow image joins the album and counts; album uploads stop at the limit.
    const slide = await agent.post(`${albumApi}/media`).set('X-CSRF-Token', csrf).attach('image', await png(), 'a.png')
    expect(slide.body.media.inAlbum).toBe(true)
    expect((await agent.post(`${albumApi}/media?album=1`).set('X-CSRF-Token', csrf).attach('image', await png(), 'b.png')).status).toBe(201)
    const over = await agent.post(`${albumApi}/media?album=1`).set('X-CSRF-Token', csrf).attach('image', await png(), 'c.png')
    expect(over.status).toBe(409)
    expect(over.body.error).toMatch(/2 photos/)

    // Slideshow images still upload when the album is full; they just stay out of it, and can't be put back in.
    const extra = await agent.post(`${albumApi}/media`).set('X-CSRF-Token', csrf).attach('image', await png(), 'd.png')
    expect(extra.status).toBe(201)
    expect(extra.body.media.inAlbum).toBe(false)
    expect((await agent.patch(`/api/admin/orgs/alpha/media/${extra.body.media.id}`).set('X-CSRF-Token', csrf).send({ inAlbum: true })).status).toBe(409)
    // Taking one out makes room.
    expect((await agent.patch(`/api/admin/orgs/alpha/media/${slide.body.media.id}`).set('X-CSRF-Token', csrf).send({ inAlbum: false })).status).toBe(200)
    expect((await agent.patch(`/api/admin/orgs/alpha/media/${extra.body.media.id}`).set('X-CSRF-Token', csrf).send({ inAlbum: true })).status).toBe(200)

    expect((await agent.get(`${albumApi}/album`)).body.usage).toEqual({ photos: 2, videos: 0 })
  })
})

describe('stored image size', () => {
  it('keeps a high-quality copy of at most 4K and a lighter web copy, without metadata', async () => {
    const big = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: '#335544' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Make: 'PhoneCo' } } })
      .toBuffer()
    const out = await processImage(big)
    const kept = await sharp(out.original).metadata()
    expect([kept.width, kept.height, kept.format]).toEqual([3840, 2560, 'jpeg'])
    expect(kept.exif).toBeUndefined()
    expect(out.originalMime).toBe('image/jpeg')
    expect([out.width, out.height]).toEqual([2560, 1707])

    // Small images aren't enlarged.
    const small = await processImage(await png())
    expect((await sharp(small.original).metadata()).width).toBe(64)
  })
})
