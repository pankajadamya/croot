import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a9a8a' } }).png().toBuffer()

async function albumSetup() {
  const { org, user, retreat } = await makeTenant('alpha')
  const { agent, csrf } = await login(user.email)
  await agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ rewardAlbumEnabled: true, rewardAlbumUrl: 'https://photos.example/album', rewardAlbumNote: 'Thank you!' })
  const up = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media?album=1`).set('X-CSRF-Token', csrf).attach('image', await png(), 'group.png')
  expect(up.status).toBe(201)
  const { token } = await invite(org.id, retreat.id)
  return { agent, csrf, retreat, token, photoId: up.body.media.id as string }
}

describe('thank-you photo album (itinerary retreats)', () => {
  it('is teased before sending, locked until sent, and never public', async () => {
    const { token, photoId } = await albumSetup()
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.album).toMatchObject({ unlocked: false, photoCount: 1, url: null, note: null })
    const teaser = await request(app).get(view.body.retreat.album.teaser[0])
    expect(teaser.status).toBe(200)
    expect((await sharp(teaser.body).metadata()).width).toBe(48) // tiny and blurred, not the photo
    expect((await request(app).get(`/api/invites/${token}/album`)).status).toBe(403)
    expect((await request(app).get(`/api/invites/${token}/album/${photoId}`)).status).toBe(403)
    expect((await request(app).get(`/media/${photoId}`)).status).toBe(404)
  })

  it('unlocks once any review is sent, even a private-only one with nothing published', async () => {
    const { token, photoId } = await albumSetup()
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, keepText: 'The mornings' })
    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    expect(sent.status).toBe(200)

    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.album).toMatchObject({ unlocked: true, url: 'https://photos.example/album', note: 'Thank you!' })
    const album = await request(app).get(`/api/invites/${token}/album`)
    expect(album.body.photos).toHaveLength(1)
    expect((await request(app).get(album.body.photos[0].url)).status).toBe(200)

    // The private response page has it too.
    const receipt = await request(app).get(`/api/responses/${sent.body.receiptToken}`)
    expect(receipt.body.album.unlocked).toBe(true)
    expect((await request(app).get(`/api/responses/${sent.body.receiptToken}/album/${photoId}`)).status).toBe(200)
    // Still never public.
    expect((await request(app).get(`/media/${photoId}`)).status).toBe(404)
  })

  it('does not exist for properties or when switched off', async () => {
    const { org, retreat } = await makeTenant('lodge', { kind: 'property' })
    await prisma.retreat.update({ where: { id: retreat.id }, data: { rewardAlbumEnabled: true, rewardAlbumUrl: 'https://photos.example' } })
    const { token } = await invite(org.id, retreat.id)
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.album).toBeNull()
  })
})

describe('property stay dates', () => {
  it('are prefilled from the invitation and editable by the guest', async () => {
    const { org, retreat } = await makeTenant('lodge', { kind: 'property' })
    const { attendee, token } = await invite(org.id, retreat.id)
    await prisma.attendee.update({ where: { id: attendee.id }, data: { stayStart: new Date('2026-09-12'), stayEnd: new Date('2026-09-15') } })
    let view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.stay.start).toContain('2026-09-12')

    const bad = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, stay: { start: '2026-09-15', end: '2026-09-12' } })
    expect(bad.status).toBe(400)
    const ok = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, stay: { start: '2026-09-13', end: '2026-09-16' } })
    expect(ok.status).toBe(200)
    view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.stay).toMatchObject({ start: expect.stringContaining('2026-09-13'), end: expect.stringContaining('2026-09-16') })
  })

  it('are ignored for itinerary retreats', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { attendee, token } = await invite(org.id, retreat.id)
    await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, stay: { start: '2026-09-13', end: '2026-09-16' } })
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: attendee.id } })).stayStart).toBeNull()
    expect((await request(app).get(`/api/invites/${token}`)).body.stay).toBeNull()
  })
})
