import request from 'supertest'
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
  it('lets an organiser tick slideshows before an image is ready, but never shows it until it is', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    await prisma.retreat.update({ where: { id: retreat.id }, data: { writingSlideshowEnabled: true } })
    const { token } = await invite(org.id, retreat.id)
    const { agent, csrf } = await login(user.email)
    const img = await organiserImage(org.id, retreat.id, { publishConsent: true })

    // Ticking is allowed without alt text (it means "include when ready").
    const tick = await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ inWritingSlideshow: true })
    expect(tick.status).toBe(200)
    expect(tick.body.media.approved).toBe(false)
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.slideshow).toEqual([])
    expect((await request(app).get(`/media/${img.id}`)).status).toBe(404)

    // Alt text + permission → approved → shown.
    const ready = await agent.patch(`/api/admin/orgs/alpha/media/${img.id}`).set('X-CSRF-Token', csrf).send({ altText: 'Sunrise over the valley' })
    expect(ready.body.media.approved).toBe(true)
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.slideshow).toEqual([{ url: `/media/${img.id}`, alt: 'Sunrise over the valley', caption: '' }])
  })

  it('shows nothing beside the form while the programme switch is off', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    await organiserImage(org.id, retreat.id, { altText: 'A view', publishConsent: true, moderation: 'approved' })
    expect((await request(app).get(`/api/invites/${token}`)).body.retreat.slideshow).toEqual([])
  })
})
