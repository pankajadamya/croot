import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a9a8a' } }).png().toBuffer()

describe('album memory film', () => {
  it('the organiser picks its music; every album view carries what the film needs and nothing more', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const admin = (body: object) => agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send(body)
    expect((await admin({ rewardAlbumEnabled: true, organiserName: 'Balance & Beyond' })).status).toBe(200)
    await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media?album=1`).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').attach('image', await png(), 'group.png')

    expect((await admin({ filmMusic: 'disco' })).status).toBe(400)
    expect((await admin({ filmMusic: 'warm' })).body.retreat.filmMusic).toBe('warm')

    // The guest's own album view, after sending a review…
    const { token } = await invite(org.id, retreat.id)
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, keepText: 'The mornings' })
    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    const mine = (await request(app).get(`/api/invites/${token}/album`)).body
    expect(mine.film).toEqual({ music: 'warm', startDate: '2026-10-23T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z', organiser: 'Balance & Beyond' })
    expect(mine.photos[0]).toMatchObject({ focalX: 0.5, focalY: 0.5 })

    // …their response page's album, and the share link's: the same film.
    expect((await request(app).get(`/api/responses/${sent.body.receiptToken}/album`)).body.film).toEqual(mine.film)
    const shared = (await request(app).get(mine.pageUrl.replace('/album/', '/api/albums/'))).body
    expect(shared.film).toEqual(mine.film)
    expect(shared.photos.map((p: { id: string }) => p.id)).toEqual(mine.photos.map((p: { id: string }) => p.id))
  })
})

describe('saving one retreat setting', () => {
  it('leaves the others as they were', async () => {
    const { user, retreat } = await makeTenant('alpha', { kind: 'property' })
    const { agent, csrf } = await login(user.email)
    const admin = (body: object) => agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send(body)
    await admin({ organiserName: 'Balance & Beyond', locationSummary: 'Himachal, India', routeSummary: ['Delhi', 'Arkja'] })
    const after = (await admin({ publicReviewsEnabled: false })).body.retreat
    expect(after).toMatchObject({ kind: 'property', organiserName: 'Balance & Beyond', locationSummary: 'Himachal, India', routeSummary: ['Delhi', 'Arkja'], publicReviewsEnabled: false })
  })
})

describe('the same picture uploaded twice', () => {
  it('shows once in the album and film, is marked for the organiser, and is not added again', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    await agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ rewardAlbumEnabled: true })
    const picture = await png()
    const up = (album: boolean) =>
      agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media${album ? '?album=1' : ''}`).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').attach('image', picture, 'same.png')
    // An album upload, then the same file as a slideshow image: it doesn't join the album twice.
    expect((await up(true)).status).toBe(201)
    const slideshow = await up(false)
    expect(slideshow.status).toBe(201)
    expect(slideshow.body.media.inAlbum).toBe(false)
    // And the album refuses it outright.
    expect((await up(true)).status).toBe(409)

    // Duplicates made before this check: shown once, and marked.
    await prisma.mediaAsset.update({ where: { id: slideshow.body.media.id }, data: { inAlbum: true } })
    const admin = (await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body
    expect(Object.keys(admin.duplicates)).toEqual([slideshow.body.media.id])
    const pageUrl = admin.pageUrl as string
    const shared = (await request(app).get(pageUrl.replace('/album/', '/api/albums/'))).body
    expect(shared.photos).toHaveLength(1)

    // One click removes the extra copy: here a slideshow image, so it's only taken out of the album.
    expect((await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/album/remove-duplicates`).set('X-CSRF-Token', csrf)).body).toEqual({ removed: 1 })
    expect((await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body.duplicates).toEqual({})
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: slideshow.body.media.id } })).toMatchObject({ removedAt: null, inAlbum: false })
  })
})
