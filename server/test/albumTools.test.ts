import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

// Each test image differs (the album shows a byte-identical picture only once).
let nth = 0
const png = (shade = 120) => sharp({ create: { width: 40 + nth++, height: 30, channels: 3, background: { r: shade, g: 140, b: 130 } } }).png().toBuffer()

async function setup() {
  const { org, user, retreat } = await makeTenant('alpha')
  const { agent, csrf } = await login(user.email)
  await agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ rewardAlbumEnabled: true })
  const upload = async (album: boolean, shade = 100) => {
    const res = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media${album ? '?album=1' : ''}`).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').attach('image', await png(shade), 'p.png')
    expect(res.status).toBe(201)
    return res.body.media as { id: string; inHeroSlideshow: boolean }
  }
  return { org, retreat, agent, csrf, upload }
}

describe('slideshow limit', () => {
  it('holds at most 10 photos: later uploads wait outside it, and switching an 11th on is refused', async () => {
    const { agent, csrf, upload } = await setup()
    const first = []
    for (let i = 0; i < 10; i++) first.push(await upload(false, 100 + i))
    expect(first.every((m) => m.inHeroSlideshow)).toBe(true)
    const eleventh = await upload(false, 200)
    expect(eleventh.inHeroSlideshow).toBe(false)
    const on = await agent.patch(`/api/admin/orgs/alpha/media/${eleventh.id}`).set('X-CSRF-Token', csrf).send({ inHeroSlideshow: true })
    expect(on.status).toBe(409)
    // Take one out, and there's room again.
    await agent.patch(`/api/admin/orgs/alpha/media/${first[0].id}`).set('X-CSRF-Token', csrf).send({ inHeroSlideshow: false })
    expect((await agent.patch(`/api/admin/orgs/alpha/media/${eleventh.id}`).set('X-CSRF-Token', csrf).send({ inHeroSlideshow: true })).status).toBe(200)
  })
})

describe('delete all', () => {
  it('empties the album: its uploads are deleted, other images only taken out, the title photo cleared', async () => {
    const { org, retreat, agent, csrf, upload } = await setup()
    const albumPhoto = await upload(true)
    const slideshowPhoto = await upload(false)
    await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/cover`).set('X-CSRF-Token', csrf).send({ mediaId: albumPhoto.id })
    await invite(org.id, retreat.id)

    const res = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/clear`).set('X-CSRF-Token', csrf)
    expect(res.body).toEqual({ deleted: 1, takenOut: 1 })
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: albumPhoto.id } })).removedAt).not.toBeNull()
    const kept = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: slideshowPhoto.id } })
    expect(kept).toMatchObject({ removedAt: null, inAlbum: false, inHeroSlideshow: true })
    expect((await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })).rewardAlbumCoverId).toBeNull()
  })

  it('deletes every slideshow image in one go, and only for this organisation', async () => {
    const { retreat, agent, csrf, upload } = await setup()
    await upload(false)
    await upload(false)
    const other = await makeTenant('beta')
    const theirs = await login(other.user.email)
    expect((await theirs.agent.post(`/api/admin/orgs/beta/retreats/${retreat.id}/media/clear`).set('X-CSRF-Token', theirs.csrf)).status).toBe(404)
    expect((await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media/clear`).set('X-CSRF-Token', csrf)).body).toEqual({ deleted: 2 })
    expect(await prisma.mediaAsset.count({ where: { retreatId: retreat.id, removedAt: null } })).toBe(0)
    expect((await request(app).get(`/api/admin/orgs/alpha/retreats/${retreat.id}/media`)).status).toBe(401)
  })
})
