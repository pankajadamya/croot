import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { runRetention } from '../src/jobs/retention.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { storage } from '../src/lib/storage.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

/** A sent review with ratings, a photo and a video (files in storage), and a consent on record. */
async function sentReview() {
  const t = await makeTenant('alpha')
  const { attendee, token } = await invite(t.org.id, t.retreat.id, 'Ravi', 'ravi@example.test')
  const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'A wonderful week of yoga by the sea.', consents: { publicText: true } })
  expect(draft.status).toBe(200)
  expect((await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })).status).toBe(200)
  const response = await prisma.response.findUniqueOrThrow({ where: { attendeeId: attendee.id } })
  for (const [key, body, type] of [
    ['bin/web.webp', 700, 'image/webp'],
    ['bin/thumb.webp', 200, 'image/webp'],
    ['bin/clip.mp4', 900, 'video/mp4'],
  ] as const) {
    await storage.put(key, Buffer.alloc(body), type)
  }
  const base = { organisationId: t.org.id, retreatId: t.retreat.id, responseId: response.id, kind: 'guest' as const, mime: 'image/webp', sizeBytes: 700, width: 800, height: 600, moderation: 'approved' as const }
  const photo = await prisma.mediaAsset.create({ data: { ...base, derivativeKey: 'bin/web.webp', thumbKey: 'bin/thumb.webp', caption: 'Sunrise' } })
  await prisma.mediaAsset.create({ data: { ...base, derivativeKey: 'bin/web.webp', videoKey: 'bin/clip.mp4', mime: 'video/mp4' } })
  await prisma.photoHeart.create({ data: { photoId: photo.id, voterHash: 'v1' } })
  await prisma.retreat.update({ where: { id: t.retreat.id }, data: { rewardAlbumCoverId: photo.id } })
  return { ...t, attendee, token, response, photo }
}

describe('recycle bin for reviews', () => {
  it('deletes a review with its photos, restores it exactly, and its link works again', async () => {
    const { user, retreat, attendee, token, response, photo } = await sentReview()
    const { agent, csrf } = await login(user.email)
    const api = '/api/admin/orgs/alpha'

    const binned = await agent.post(`${api}/attendees/${attendee.id}/bin`).set('X-CSRF-Token', csrf)
    expect(binned.status).toBe(200)
    // Gone from everywhere: guest list, review, photos, the album cover, the guest's link.
    expect(await prisma.attendee.count()).toBe(0)
    expect(await prisma.response.count()).toBe(0)
    expect(await prisma.mediaAsset.count()).toBe(0)
    expect((await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })).rewardAlbumCoverId).toBeNull()
    expect((await request(app).get(`/api/invites/${token}`)).status).toBeGreaterThanOrEqual(400)
    // The files are kept while it's in the bin.
    expect(await storage.size('bin/clip.mp4')).toBe(900)

    const list = await agent.get(`${api}/retreats/${retreat.id}/recycle-bin`)
    expect(list.body.items).toEqual([expect.objectContaining({ guestName: 'Ravi', hadReview: true, photoCount: 2 })])

    const restored = await agent.post(`${api}/recycle-bin/${binned.body.id}/restore`).set('X-CSRF-Token', csrf)
    expect(restored.status).toBe(200)
    expect(restored.body).toEqual({ attendeeId: attendee.id, responseId: response.id })
    const back = await prisma.response.findUniqueOrThrow({ where: { id: response.id }, include: { media: { include: { hearts: true } }, ratings: true, consents: true } })
    expect(back.storyText).toBe('A wonderful week of yoga by the sea.')
    expect(back.submittedAt?.toISOString()).toBe(response.submittedAt?.toISOString())
    expect(back.media.map((m) => m.id)).toContain(photo.id)
    expect(back.media.find((m) => m.id === photo.id)).toMatchObject({ caption: 'Sunrise', hearts: [expect.objectContaining({ voterHash: 'v1' })] })
    expect(back.consents.length).toBeGreaterThan(0)
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(200)
    expect(await prisma.recycledGuest.count()).toBe(0)
  })

  it('only owners can delete or restore, and a restore never clashes with a guest added since', async () => {
    const { org, user, retreat, attendee } = await sentReview()
    const helper = await prisma.user.create({ data: { email: 'helper@alpha.test', name: 'Helper', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash } })
    await prisma.membership.create({ data: { userId: helper.id, organisationId: org.id, role: 'organiser' } })
    const editor = await login('helper@alpha.test')
    expect((await editor.agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/bin`).set('X-CSRF-Token', editor.csrf)).status).toBe(403)

    const owner = await login(user.email)
    const binned = await owner.agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/bin`).set('X-CSRF-Token', owner.csrf)
    await invite(org.id, retreat.id, 'Ravi again', 'ravi@example.test')
    const clash = await owner.agent.post(`/api/admin/orgs/alpha/recycle-bin/${binned.body.id}/restore`).set('X-CSRF-Token', owner.csrf)
    expect(clash.status).toBe(409)
    expect(await prisma.recycledGuest.count()).toBe(1)
  })

  it('is emptied after 30 days, files included; "Delete for good" does it straight away', async () => {
    const { user, attendee } = await sentReview()
    const { agent, csrf } = await login(user.email)
    await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/bin`).set('X-CSRF-Token', csrf)

    await runRetention(new Date(Date.now() + 29 * 86_400_000))
    expect(await prisma.recycledGuest.count()).toBe(1)
    await runRetention(new Date(Date.now() + 31 * 86_400_000))
    expect(await prisma.recycledGuest.count()).toBe(0)
    expect(await storage.get('bin/clip.mp4')).toBeNull()
    expect(await storage.get('bin/thumb.webp')).toBeNull()
  })

  it('"Delete for good" erases the entry and its files at once', async () => {
    const { user, attendee } = await sentReview()
    const { agent, csrf } = await login(user.email)
    const binned = await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/bin`).set('X-CSRF-Token', csrf)
    expect((await agent.delete(`/api/admin/orgs/alpha/recycle-bin/${binned.body.id}`).set('X-CSRF-Token', csrf)).status).toBe(204)
    expect(await prisma.recycledGuest.count()).toBe(0)
    expect(await storage.get('bin/web.webp')).toBeNull()
  })
})
