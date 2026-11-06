import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

async function organiserImage(orgId: string, retreatId: string, data: Partial<{ altText: string; publishConsent: boolean; moderation: 'pending' | 'approved' }> = {}) {
  return prisma.mediaAsset.create({
    data: {
      organisationId: orgId,
      retreatId,
      kind: 'organiser',
      originalKey: 'x/original',
      derivativeKey: 'x/web.webp',
      mime: 'image/jpeg',
      sizeBytes: 1,
      width: 10,
      height: 10,
      inHeroSlideshow: true,
      inWritingSlideshow: true,
      ...data,
    },
  })
}

describe('retreat photo slideshows', () => {
  it('requires an explicit upload acknowledgement and makes new organiser photos ready', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#739482' } }).png().toBuffer()
    const url = `/api/admin/orgs/alpha/retreats/${retreat.id}/media`
    expect((await agent.post(url).set('X-CSRF-Token', csrf).attach('image', photo, 'photo.png')).status).toBe(400)
    const uploaded = await agent.post(url).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').attach('image', photo, 'photo.png')
    expect(uploaded.status).toBe(201)
    expect(uploaded.body.media).toMatchObject({ rightsConfirmed: true, approved: true, inHeroSlideshow: true })
  })

  it('moves organiser images in the saved slideshow order', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const first = await organiserImage(org.id, retreat.id, { publishConsent: true, moderation: 'approved' })
    const second = await organiserImage(org.id, retreat.id, { publishConsent: true, moderation: 'approved' })
    const url = `/api/admin/orgs/alpha/retreats/${retreat.id}/media/order`
    expect((await agent.put(url).set('X-CSRF-Token', csrf).send({ ids: [second.id] })).status).toBe(400)
    expect((await agent.put(url).set('X-CSRF-Token', csrf).send({ ids: [second.id, first.id] })).status).toBe(200)
    const list = await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/media`)
    expect(list.body.media.map((m: { id: string }) => m.id)).toEqual([second.id, first.id])
  })

  it('shows public slideshow images beside the guest form once permission is confirmed', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const { agent, csrf } = await login(user.email)
    const img = await organiserImage(org.id, retreat.id)

    // Ticking is allowed before permission is confirmed (it means "include when ready").
    const tick = await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ inHeroSlideshow: true, inWritingSlideshow: false })
    expect(tick.status).toBe(200)
    expect(tick.body.media.approved).toBe(false)
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.slideshow).toEqual([])
    expect((await request(app).get(`/media/${img.id}`)).status).toBe(404)

    // Permission alone makes it ready: alt text is optional, with a fallback for screen readers.
    const ready = await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ rightsConfirmed: true })
    expect(ready.body.media.approved).toBe(true)
    let view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.slideshow).toEqual([{ url: `/media/${img.id}`, alt: 'Retreat photo', caption: '' }])

    // A caption is used as the alt text when there is none; real alt text wins.
    await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ caption: 'Morning practice' })
    view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.slideshow[0].alt).toBe('Morning practice')
    await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ altText: 'Sunrise over the valley' })
    view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.slideshow[0].alt).toBe('Sunrise over the valley')

    // Withdrawing permission hides it again.
    await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ rightsConfirmed: false })
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.slideshow).toEqual([])
  })

  it('shows the organiser’s opening to guests only once it is published', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const opening = { organisationId: org.id, retreatId: retreat.id, headline: 'From Delhi to the foothills', introParagraphs: ['Ten days together.'], ctaLabel: 'Explore', ctaUrl: 'https://example.test' }
    await prisma.contentRevision.create({ data: { ...opening, status: 'draft' } })
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.opening).toBeNull()
    await prisma.contentRevision.create({ data: { ...opening, status: 'published' } })
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.opening).toEqual({ headline: 'From Delhi to the foothills', introParagraphs: ['Ten days together.'] })
  })

  it('uses slideshow membership even when the old guest-form switch is off', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    await organiserImage(org.id, retreat.id, { altText: 'A view', publishConsent: true, moderation: 'approved' })
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.slideshow).toEqual([{ url: expect.stringContaining('/media/'), alt: 'A view', caption: '' }])
  })
})
