import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { resetHeartCaps } from '../src/lib/hearts.js'
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

  it('includes photos guests choose to share once they have sent their review and the organiser approves them', async () => {
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
    // Shared and sent, but not yet approved: not in the album.
    expect(await ids()).not.toContain(shared)
    const manage = await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)
    expect(manage.body.media.find((m: { id: string }) => m.id === shared)).toMatchObject({ sharedByGuest: true, approved: false })
    // Approving publishes it straight away (album-only sharing can be approved too).
    expect((await agent.post(`/api/admin/orgs/alpha/media/${shared}/moderate`).set('X-CSRF-Token', csrf).send({ status: 'approved' })).status).toBe(200)
    expect(await ids()).toContain(shared)
    expect(await ids()).not.toContain(unsharedUp.body.id)
    const mine = (await request(app).get(`/api/invites/${sharer.token}/album`)).body.photos.find((p: { id: string }) => p.id === shared)
    expect(mine).toMatchObject({ sharedByGuest: true, mine: true })

    // Contributing straight from the album page, then withdrawing from the private page.
    const added = await request(app).post(`/api/invites/${sharer.token}/album/photos`).attach('photo', await png(), 'more.png')
    expect(added.status).toBe(201)
    expect(await ids()).not.toContain(added.body.id) // waits for approval
    await agent.post(`/api/admin/orgs/alpha/media/${added.body.id}/moderate`).set('X-CSRF-Token', csrf).send({ status: 'approved' })
    expect(await ids()).toContain(added.body.id)
    await request(app).post(`/api/responses/${sent.body.receiptToken}/withdraw`).send({ scope: 'album_photo', photoId: added.body.id })
    expect(await ids()).not.toContain(added.body.id)

    // The organiser can take a guest's shared photo out of the album.
    await agent.patch(`/api/admin/orgs/alpha/media/${shared}`).set('X-CSRF-Token', csrf).send({ inAlbum: false })
    expect(await ids()).not.toContain(shared)
    // Still never public.
    expect((await request(app).get(`/media/${shared}`)).status).toBe(404)
  })

  it('is reached by an unguessable link that anyone can open, not from the public pages, and can be replaced', async () => {
    const { agent, csrf, retreat, token, photoId } = await albumSetup()
    const pageUrl = (await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body.pageUrl as string
    expect(pageUrl).toMatch(/^\/album\/[\w-]{24,}$/)
    const api = `/api${pageUrl.replace('/album/', '/albums/')}`

    // The public retreat page doesn't mention it, and the old predictable address is gone.
    expect((await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)).body.album).toBeUndefined()
    expect((await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}/album`)).status).toBe(404)

    // No cookies, no review: the link opens the album and its photos; adding photos needs a sent review.
    const album = await request(app).get(api)
    expect(album.status).toBe(200)
    expect(album.body).toMatchObject({ canContribute: false, pageUrl, heartsApi: api, orgName: expect.any(String) })
    expect(album.body.photos.map((p: { id: string }) => p.id)).toEqual([photoId])
    expect((await request(app).get(album.body.photos[0].url)).status).toBe(200)
    expect((await request(app).post(`/api/invites/${token}/album/photos`).attach('photo', await png(), 'x.png')).status).toBe(403)
    // Guests get the same link.
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, keepText: 'x' })
    await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    expect((await request(app).get(`/api/invites/${token}/album`)).body.pageUrl).toBe(pageUrl)

    // A new link stops the old one.
    const fresh = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/share-link`).set('X-CSRF-Token', csrf).send({})
    expect(fresh.body.pageUrl).not.toBe(pageUrl)
    expect((await request(app).get(api)).status).toBe(404)
    // Switching the album off closes it.
    await agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ rewardAlbumEnabled: false })
    expect((await request(app).get(`/api${fresh.body.pageUrl.replace('/album/', '/albums/')}`)).status).toBe(404)
  })

  it('lets anyone heart a photo once, takes it back on a second tap, and caps repeat hearts from one place', async () => {
    resetHeartCaps()
    const { agent, retreat, photoId } = await albumSetup()
    const pageUrl = (await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body.pageUrl as string
    const base = `/api${pageUrl.replace('/album/', '/albums/')}`
    const voter = (n: number) => `visitor-${n}-abcdefghijklmnopqrstuvwxyz`
    const heart = (v: string, on: boolean) => request(app).post(`${base}/${photoId}/heart`).send({ voter: v, on })

    expect((await heart(voter(1), true)).body).toEqual({ hearts: 1, hearted: true })
    expect((await heart(voter(1), true)).body.hearts).toBe(1) // once per visitor
    expect((await request(app).post(`${base}/hearts/mine`).send({ voter: voter(1), photoIds: [photoId] })).body.hearted).toEqual([photoId])
    expect((await request(app).get(base)).body.photos[0].hearts).toBe(1)
    expect((await heart(voter(1), false)).body.hearts).toBe(0) // taken back

    // A few more from the same place are fine; then that photo is capped for the day.
    for (let n = 2; n <= 5; n++) expect((await heart(voter(n), true)).status).toBe(200)
    expect((await heart(voter(99), true)).status).toBe(429)

    // Only album photos, and only well-formed visitor ids.
    expect((await request(app).post(`${base}/${crypto.randomUUID()}/heart`).send({ voter: voter(7), on: true })).status).toBe(404)
    expect((await heart('x', true)).status).toBe(400)
    // Nothing identifying is stored: just the photo and a keyed hash.
    const row = await prisma.photoHeart.findFirstOrThrow()
    expect(Object.keys(row).sort()).toEqual(['photoId', 'voterHash'])
    expect(row.voterHash).not.toContain('visitor')
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

describe('album videos (organisers)', () => {
  // The start of an MP4 file ("ftyp" box), padded out: enough for type checks and range requests.
  const fakeMp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4000, 7)])

  it('uploads with a poster, lists it as a video, and streams it with Range support', async () => {
    const { agent, csrf, retreat } = await albumSetup()
    const up = await agent
      .post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/videos`)
      .set('X-CSRF-Token', csrf)
      .attach('video', fakeMp4(), 'clip.mp4')
      .attach('poster', await png(), 'poster.png')
      .field('width', '1920')
      .field('height', '1080')
      .field('duration', '12.5')
    expect(up.status).toBe(201)
    expect(up.body.media).toMatchObject({ isVideo: true, durationSec: 12.5 })

    const link = (await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body.pageUrl as string
    const album = await request(app).get(`/api${link.replace('/album/', '/albums/')}`)
    const video = album.body.photos.find((p: { id: string }) => p.id === up.body.media.id)
    expect(video).toMatchObject({ width: 1920, height: 1080, duration: 12.5, video: expect.stringContaining('/video') })
    expect((await request(app).get(video.url)).headers['content-type']).toBe('image/webp') // its poster

    const whole = await request(app).get(video.video).buffer(true)
    expect(whole.status).toBe(200)
    expect(whole.headers['accept-ranges']).toBe('bytes')
    expect(Number(whole.headers['content-length'])).toBe(fakeMp4().length)
    const part = await request(app).get(video.video).set('Range', 'bytes=4-11').buffer(true)
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 4-11/${fakeMp4().length}`)
    expect(Buffer.from(part.body).toString('ascii')).toBe('ftypisom')
  })

  it('refuses files that are not videos, and only organisers can upload', async () => {
    const { agent, csrf, retreat, token } = await albumSetup()
    const bad = await agent
      .post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/videos`)
      .set('X-CSRF-Token', csrf)
      .attach('video', Buffer.from('not a video at all'), 'clip.mp4')
    expect(bad.status).toBe(415)
    expect((await request(app).post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/videos`).attach('video', fakeMp4(), 'x.mp4')).status).toBe(401)
    // Guests' own album uploads are photos only.
    expect((await request(app).post(`/api/invites/${token}/album/photos`).attach('photo', fakeMp4(), 'x.mp4')).status).not.toBe(201)
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
