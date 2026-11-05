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

  it('includes earlier images, follows the chosen order, puts the title photo first, and honours removal', async () => {
    const { agent, csrf, retreat, token, photoId } = await albumSetup()
    // An image added earlier in "Your images" (organiser kind): in the album by default.
    const earlier = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media`).set('X-CSRF-Token', csrf).attach('image', await png(), 'view.png')
    const earlierId = earlier.body.media.id as string
    const manage = await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)
    expect(manage.body.media.map((m: { id: string }) => m.id)).toEqual([photoId, earlierId])

    // Reorder, then make the album upload the title photo.
    await agent.put(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/order`).set('X-CSRF-Token', csrf).send({ ids: [earlierId, photoId] })
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, keepText: 'x' })
    await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    let album = await request(app).get(`/api/invites/${token}/album`)
    expect(album.body.photos.map((p: { id: string }) => p.id)).toEqual([earlierId, photoId])
    await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/cover`).set('X-CSRF-Token', csrf).send({ mediaId: photoId })
    album = await request(app).get(`/api/invites/${token}/album`)
    expect(album.body.coverId).toBe(photoId)
    expect(album.body.photos.map((p: { id: string }) => p.id)).toEqual([photoId, earlierId])

    // Taking the earlier image out of the album hides it from guests (it stays in "Your images").
    await agent.patch(`/api/admin/orgs/alpha/media/${earlierId}`).set('X-CSRF-Token', csrf).send({ inAlbum: false })
    album = await request(app).get(`/api/invites/${token}/album`)
    expect(album.body.photos.map((p: { id: string }) => p.id)).toEqual([photoId])
    expect((await request(app).get(`/api/invites/${token}/album/${earlierId}`)).status).toBe(404)
  })

  it('includes photos guests choose to share, only once they have sent their review', async () => {
    const { agent, csrf, retreat, token: reviewerToken } = await albumSetup()
    const { org } = { org: await prisma.organisation.findFirstOrThrow() }
    const sharer = await invite(org.id, retreat.id, 'Sharer', 'sharer@example.test')

    // A photo uploaded in the review form, with group sharing switched on (opt-in).
    const up = await request(app).post(`/api/invites/${sharer.token}/photos`).attach('photo', await png(), 'mine.png')
    const shared = up.body.id as string
    const unsharedUp = await request(app).post(`/api/invites/${sharer.token}/photos`).attach('photo', await png(), 'private.png')
    expect((await request(app).patch(`/api/invites/${sharer.token}/photos/${shared}`).send({ albumConsent: true })).body.albumConsent).toBe(true)

    // The other guest has sent their review; the sharer hasn't yet → not in the album.
    const d1 = await request(app).put(`/api/invites/${reviewerToken}/draft`).send({ revision: 0, keepText: 'x' })
    await request(app).post(`/api/invites/${reviewerToken}/submit`).send({ revision: d1.body.revision })
    const ids = async () => (await request(app).get(`/api/invites/${reviewerToken}/album`)).body.photos.map((p: { id: string }) => p.id)
    expect(await ids()).not.toContain(shared)

    // Once the sharer sends their review, it appears (the unshared one never does).
    const rev = (await request(app).get(`/api/invites/${sharer.token}`)).body.response.revision
    const d2 = await request(app).put(`/api/invites/${sharer.token}/draft`).send({ revision: rev, keepText: 'y' })
    expect(d2.status).toBe(200)
    const sent = await request(app).post(`/api/invites/${sharer.token}/submit`).send({ revision: d2.body.revision })
    expect(await ids()).toContain(shared)
    expect(await ids()).not.toContain(unsharedUp.body.id)
    const mine = (await request(app).get(`/api/invites/${sharer.token}/album`)).body.photos.find((p: { id: string }) => p.id === shared)
    expect(mine).toMatchObject({ sharedByGuest: true, mine: true })

    // Contributing straight from the album page, then withdrawing from the private page.
    const added = await request(app).post(`/api/invites/${sharer.token}/album/photos`).attach('photo', await png(), 'more.png')
    expect(added.status).toBe(201)
    expect(await ids()).toContain(added.body.id)
    await request(app).post(`/api/responses/${sent.body.receiptToken}/withdraw`).send({ scope: 'album_photo', photoId: added.body.id })
    expect(await ids()).not.toContain(added.body.id)

    // The organiser can take a guest's shared photo out of the album.
    await agent.patch(`/api/admin/orgs/alpha/media/${shared}`).set('X-CSRF-Token', csrf).send({ inAlbum: false })
    expect(await ids()).not.toContain(shared)
    // Still never public.
    expect((await request(app).get(`/media/${shared}`)).status).toBe(404)
  })

  it('is a public page of the retreat: anyone can view it without signing in, linked from the retreat page', async () => {
    const { agent, csrf, retreat, token, photoId } = await albumSetup()
    const pageUrl = `/o/alpha/r/${retreat.slug}/album`
    expect((await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body.pageUrl).toBe(pageUrl)

    // The retreat page links to it, with its title photo.
    const page = () => request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)
    const link = (await page()).body.album
    expect(link).toMatchObject({ url: pageUrl, count: 1 })
    expect((await request(app).get(link.cover)).status).toBe(200)

    // No cookies, no review: the album page and its photos are open; adding photos is not.
    const album = await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}/album`)
    expect(album.status).toBe(200)
    expect(album.body).toMatchObject({ canContribute: false, pageUrl })
    expect(album.body.photos.map((p: { id: string }) => p.id)).toEqual([photoId])
    expect((await request(app).get(album.body.photos[0].url)).status).toBe(200)
    expect((await request(app).post(`/api/public/orgs/alpha/retreats/${retreat.slug}/album/photos`).attach('photo', await png(), 'x.png')).status).toBe(404)
    // Contributing still needs a sent review.
    expect((await request(app).post(`/api/invites/${token}/album/photos`).attach('photo', await png(), 'x.png')).status).toBe(403)

    // Switching the album off takes the page and the link down.
    await agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ rewardAlbumEnabled: false })
    expect((await page()).body.album).toBeNull()
    expect((await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}/album`)).status).toBe(404)
  })

  it('does not let a guest who has not sent a review add photos', async () => {
    const { token } = await albumSetup()
    expect((await request(app).post(`/api/invites/${token}/album/photos`).attach('photo', await png(), 'x.png')).status).toBe(403)
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
