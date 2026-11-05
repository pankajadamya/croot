import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, closeDatabase } from '../src/lib/prisma.js'
import { redactPath } from '../src/lib/logger.js'
import { resetHeartCaps } from '../src/lib/hearts.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

async function submitStory(token: string, story: string, consents: Record<string, boolean>) {
  const start = await request(app).get(`/api/invites/${token}`)
  expect(start.status).toBe(200)
  const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: start.body.response?.revision ?? 0, storyText: story, consents })
  expect(saved.status).toBe(200)
  const submitted = await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })
  expect(submitted.status).toBe(200)
  return submitted.body.receiptToken as string
}

describe('invitations', () => {
  it('returns one generic error for unknown, malformed and revoked links', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { attendee, token } = await invite(org.id, retreat.id)
    const unknown = await request(app).get(`/api/invites/${'x'.repeat(43)}`)
    const malformed = await request(app).get('/api/invites/abc')
    await prisma.invitation.updateMany({ where: { attendeeId: attendee.id }, data: { revokedAt: new Date() } })
    const revoked = await request(app).get(`/api/invites/${token}`)
    expect(new Set([unknown.status, malformed.status, revoked.status])).toEqual(new Set([404]))
    expect(unknown.body.error).toBe(revoked.body.error)
    // A revoked link cannot save either.
    const save = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'x' })
    expect(save.status).toBe(404)
  })

  it('stores only a hash of the token and shows the first name only', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Anika Example')
    const row = await prisma.invitation.findFirstOrThrow()
    expect(row.tokenHash).not.toContain(token)
    const res = await request(app).get(`/api/invites/${token}`)
    expect(res.body.firstName).toBe('Anika')
    expect(JSON.stringify(res.body)).not.toContain('guest@example.test')
  })

  it('rejects a stale draft revision instead of overwriting newer text', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const a = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'from phone' })
    expect(a.status).toBe(200)
    const b = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'from laptop' })
    expect(b.status).toBe(409)
  })

  it('allows a private-only submission and submits only once', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    await submitStory(token, '', {})
    const again = await request(app).post(`/api/invites/${token}/submit`).send({ revision: 0 })
    expect(again.body.alreadySubmitted).toBe(true)
    expect(await prisma.response.count()).toBe(1)
  })
})

describe('tenant isolation', () => {
  it('hides another tenant’s data behind not-found', async () => {
    const a = await makeTenant('alpha')
    const b = await makeTenant('beta')
    const { agent } = await login(a.user.email)
    expect((await agent.get('/api/admin/orgs/beta')).status).toBe(404)
    expect((await agent.get(`/api/admin/orgs/alpha/retreats/${b.retreat.id}`)).status).toBe(404)
    expect((await agent.get('/api/admin/orgs/alpha')).status).toBe(200)
  })

  it('requires the CSRF header for admin mutations', async () => {
    const a = await makeTenant('alpha')
    const { agent, csrf } = await login(a.user.email)
    const body = { title: 'New one', kind: 'property' }
    expect((await agent.post('/api/admin/orgs/alpha/retreats').send(body)).status).toBe(403)
    const ok = await agent.post('/api/admin/orgs/alpha/retreats').set('X-CSRF-Token', csrf).send(body)
    expect(ok.status).toBe(201)
    expect(ok.body.retreat.kind).toBe('property')
    expect(ok.body.retreat.feedbackCategories.map((c: { key: string }) => c.key)).toContain('cleanliness')
  })

  it('requires dates for itinerary retreats only', async () => {
    const a = await makeTenant('alpha')
    const { agent, csrf } = await login(a.user.email)
    const res = await agent.post('/api/admin/orgs/alpha/retreats').set('X-CSRF-Token', csrf).send({ title: 'Trip', kind: 'itinerary' })
    expect(res.status).toBe(400)
  })
})

describe('publication and consent', () => {
  it('cannot publish without public-text consent, and never leaks private data', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { token } = await invite(org.id, retreat.id, 'Maya Sample')
    await submitStory(token, 'A lovely week. The teachers were kind.', { publicText: false })
    const response = await prisma.response.findFirstOrThrow()
    await prisma.response.update({ where: { id: response.id }, data: { keepText: 'SECRET-KEEP' } })

    const denied = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect(denied.status).toBe(409)

    await prisma.response.update({ where: { id: response.id }, data: { consentPublicText: true } })
    const notVerbatim = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({ excerpt: 'An amazing week!' })
    expect(notVerbatim.status).toBe(400)

    const ok = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect(ok.status).toBe(200)
    const story = await request(app).get(`/api/public/stories/${ok.body.publicSlug}`)
    expect(story.status).toBe(200)
    expect(story.body.story.displayName).toBeNull() // no first-name consent
    const landing = await request(app).get('/api/public/orgs/alpha/retreats/trip')
    for (const body of [story.body, landing.body]) {
      const json = JSON.stringify(body)
      expect(json).not.toContain('SECRET-KEEP')
      expect(json).not.toContain('guest@example.test')
      expect(json).not.toContain('Maya')
    }
  })

  it('withdrawal by the guest removes the story immediately and is audited', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { token } = await invite(org.id, retreat.id)
    const receipt = await submitStory(token, 'Wonderful.', { publicText: true })
    const response = await prisma.response.findFirstOrThrow()
    const pub = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect((await request(app).get(`/api/public/stories/${pub.body.publicSlug}`)).status).toBe(200)

    const w = await request(app).post(`/api/responses/${receipt}/withdraw`).send({ scope: 'public_text' })
    expect(w.status).toBe(200)
    expect((await request(app).get(`/api/public/stories/${pub.body.publicSlug}`)).status).toBe(410)
    expect(await prisma.auditEvent.count({ where: { action: 'story.withdrawn' } })).toBe(1)
  })
})

describe('anonymous notes', () => {
  it('stores only the words and the date: no identity, time of day or link to a response', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    // The review form tells the browser where to send it: by retreat only, never the invite token.
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.anonymousNotePath).toBe(`/api/public/notes/${retreat.id}`)
    const before = await prisma.auditEvent.count()

    const res = await request(app).post(view.body.retreat.anonymousNotePath).send({ message: 'The transfers were rushed.' })
    expect(res.status).toBe(201)
    const note = await prisma.anonymousNote.findFirstOrThrow()
    expect(Object.keys(note).sort()).toEqual(['id', 'message', 'organisationId', 'receivedOn', 'retreatId'])
    expect(note.receivedOn.toISOString()).toMatch(/T00:00:00\.000Z$/) // the day only, no time
    expect(await prisma.auditEvent.count()).toBe(before)
    expect(JSON.stringify(await prisma.response.findMany())).not.toContain('transfers were rushed')

    // Held back until there are enough that a new one can't be matched to the review just sent.
    const { agent } = await login(user.email)
    let list = await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/anonymous`)
    expect(list.body).toEqual({ notes: [], held: 1, minimum: 3 })
    await request(app).post(`/api/public/notes/${retreat.id}`).send({ message: 'Zero complaints about the food.' })
    await request(app).post(`/api/public/notes/${retreat.id}`).send({ message: 'A quieter room would help.' })
    list = await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/anonymous`)
    // Alphabetical, never arrival order.
    expect(list.body.notes).toEqual([{ message: 'A quieter room would help.' }, { message: 'The transfers were rushed.' }, { message: 'Zero complaints about the food.' }])
  })

  it('refuses notes for retreats that are not collecting', async () => {
    const { retreat } = await makeTenant('alpha')
    await prisma.retreat.update({ where: { id: retreat.id }, data: { status: 'closed' } })
    expect((await request(app).post(`/api/public/notes/${retreat.id}`).send({ message: 'Too late?' })).status).toBe(409)
  })

  it('shows the organiser’s website on their public pages, set by an owner', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    expect((await agent.patch('/api/admin/orgs/alpha/profile').set('X-CSRF-Token', csrf).send({ websiteUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await agent.patch('/api/admin/orgs/alpha/profile').set('X-CSRF-Token', csrf).send({ websiteUrl: 'https://alpha.example' })).status).toBe(200)
    expect((await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)).body.org.websiteUrl).toBe('https://alpha.example')
    expect((await request(app).get('/api/public/orgs/alpha')).body.org.websiteUrl).toBe('https://alpha.example')
    await agent.patch('/api/admin/orgs/alpha/profile').set('X-CSRF-Token', csrf).send({ websiteUrl: '' })
    expect((await request(app).get('/api/public/orgs/alpha')).body.org.websiteUrl).toBeNull()
  })

  it('lists published reviews newest first, in full, with title, date and photos approved after publishing', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#88aa99' } }).png().toBuffer()
    let photoId = ''
    const send = async (name: string, email: string, body: Record<string, unknown>, withPhoto = false) => {
      const { token } = await invite(org.id, retreat.id, name, email)
      if (withPhoto) {
        // A photo with the guest's permission, not yet approved when the story is published.
        const up = await request(app).post(`/api/invites/${token}/photos`).attach('photo', png, 'p.png')
        photoId = up.body.id
        await prisma.mediaAsset.update({ where: { id: photoId }, data: { publishConsent: true } })
      }
      const rev = (await request(app).get(`/api/invites/${token}`)).body.response?.revision ?? 0
      const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: rev, consents: { publicText: true }, ...body })
      await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
      return prisma.response.findFirstOrThrow({ where: { attendee: { email } } })
    }
    const firstResponse = await send('Early Guest', 'early@example.test', { storyText: 'First paragraph.\n\nSecond paragraph.', overallRating: 4 })
    await prisma.response.update({ where: { id: firstResponse.id }, data: { submittedAt: new Date('2026-11-02T10:00:00Z') } })
    const response = await send('Late Guest', 'late@example.test', { storyTitle: 'A week to remember', storyText: 'Short and sweet.', overallRating: 5 }, true)
    const first = { response: firstResponse }
    const up = { body: { id: photoId } }
    for (const r of [first.response, response]) {
      expect((await agent.post(`/api/admin/orgs/alpha/responses/${r.id}/publish`).set('X-CSRF-Token', csrf).send({})).status).toBe(200)
    }
    await agent.post(`/api/admin/orgs/alpha/media/${up.body.id}/moderate`).set('X-CSRF-Token', csrf).send({ status: 'approved' })

    const page = await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)
    const [latest, earlier] = page.body.stories
    expect(latest).toMatchObject({ title: 'A week to remember', text: 'Short and sweet.', postedAt: expect.any(String) })
    expect(latest.photos).toHaveLength(1)
    expect(earlier).toMatchObject({ title: null, text: 'First paragraph.\n\nSecond paragraph.', overallRating: 4 })
    expect(latest.overallRating).toBe(5)
    expect(page.body.rating).toEqual({ average: 4.5, count: 2 })
    // The organiser can hide ratings; it applies straight away.
    await prisma.retreat.update({ where: { id: retreat.id }, data: { showPublicRating: false } })
    const hidden = await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)
    expect(hidden.body.rating).toBeNull()
    expect(hidden.body.stories[0].overallRating).toBeNull()
    expect((await request(app).get(latest.photos[0].url)).status).toBe(200)

    // Visitors can heart a review's photos, like album photos.
    expect(latest.photos[0]).toMatchObject({ id: photoId, hearts: 0 })
    const voter = 'review-visitor-abcdefghijklmnopqrstuvwxyz'
    const hearted = await request(app).post(`/api/public/orgs/alpha/retreats/${retreat.slug}/album/${photoId}/heart`).send({ voter, on: true })
    expect(hearted.body).toEqual({ hearts: 1, hearted: true })
    const again = await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)
    expect(again.body.stories[0].photos[0].hearts).toBe(1)
  })

  it('share kit offers only stories whose guests agreed to social-media use, with names only when allowed', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const send = async (email: string, consents: Record<string, boolean>) => {
      const { token } = await invite(org.id, retreat.id, 'Maya Guest', email)
      const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'The mornings were calm. The teachers were kind and patient.', overallRating: 5, consents })
      await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    }
    await send('social@example.test', { publicText: true, marketing: true, firstName: true })
    await send('anon-social@example.test', { publicText: true, marketing: true })
    await send('site-only@example.test', { publicText: true })

    const kit = await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/share-kit`)
    expect(kit.status).toBe(200)
    expect(kit.body.brandThemeKey).toBe('forest-linen')
    expect(kit.body.stories).toHaveLength(2)
    expect(kit.body.stories.map((s: { name: string | null }) => s.name).sort()).toEqual([null, 'Maya'].sort())
    expect(kit.body.stories[0].sentences).toEqual(['The mornings were calm.', 'The teachers were kind and patient.'])
    expect(kit.body.publicPath).toBe(`/o/alpha/r/${retreat.slug}`)

    const used = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/share-kit/used`).set('X-CSRF-Token', csrf).send({ storyIds: [kit.body.stories[0].id], format: 'post' })
    expect(used.status).toBe(200)
    expect(await prisma.auditEvent.count({ where: { action: 'share_kit.used' } })).toBe(1)
  })

  it('lets anyone mark a published review helpful once, take it back, and caps repeats from one place', async () => {
    resetHeartCaps()
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { token } = await invite(org.id, retreat.id, 'Hana Guest', 'hana@example.test')
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'A gentle, well-run week.', consents: { publicText: true } })
    await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    const response = await prisma.response.findFirstOrThrow({ where: { attendee: { email: 'hana@example.test' } } })
    const pub = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    const slug = pub.body.publicSlug as string
    const voter = (n: number) => `helpful-visitor-${n}-abcdefghijklmnopqrst`
    const vote = (v: string, on: boolean) => request(app).post(`/api/public/stories/${slug}/helpful`).send({ voter: v, on })

    expect((await vote(voter(1), true)).body).toEqual({ helpful: 1, voted: true })
    expect((await vote(voter(1), true)).body.helpful).toBe(1) // once per visitor
    expect((await request(app).post('/api/public/stories/helpful/mine').send({ voter: voter(1), slugs: [slug] })).body.helpful).toEqual([slug])
    expect((await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)).body.stories[0].helpful).toBe(1)
    expect((await request(app).get(`/api/public/stories/${slug}`)).body.story.helpful).toBe(1)
    expect((await vote(voter(1), false)).body.helpful).toBe(0)

    for (let n = 2; n <= 5; n++) expect((await vote(voter(n), true)).status).toBe(200)
    expect((await vote(voter(99), true)).status).toBe(429)
    expect((await request(app).post('/api/public/stories/not-a-story/helpful').send({ voter: voter(7), on: true })).status).toBe(404)
    // Nothing identifying is stored.
    expect(Object.keys(await prisma.reviewHelpful.findFirstOrThrow()).sort()).toEqual(['responseId', 'voterHash'])
  })

  it('points guests to the retreat’s public page once they have sent their review', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.publicPagePath).toBe(`/o/alpha/r/${retreat.slug}`)
  })
})

describe('property reviews', () => {
  it('shows a property guest their own stay dates and no itinerary publicly', async () => {
    const { org, retreat } = await makeTenant('lodge', { kind: 'property' })
    const attendee = await prisma.attendee.create({
      data: { organisationId: org.id, retreatId: retreat.id, name: 'Lena', email: 'lena@example.test', stayStart: new Date('2026-09-12'), stayEnd: new Date('2026-09-15') },
    })
    const { issueInvitation } = await import('../src/lib/invites.js')
    const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: attendee.id, ttlDays: 30 })
    const res = await request(app).get(`/api/invites/${token}`)
    expect(res.body.retreat.kind).toBe('property')
    expect(res.body.retreat.startDate).toContain('2026-09-12')
    const site = await request(app).get('/api/public/orgs/lodge/retreats/trip')
    expect(site.body.retreat.startDate).toBeNull()
    expect(site.body.retreat.routeSummary).toEqual([])
  })
})

describe('logging', () => {
  it('redacts tokens from logged paths', () => {
    expect(redactPath('/api/invites/abcDEF123_-xyz/draft?x=1')).toBe('/api/invites/[redacted]/draft')
    expect(redactPath('/response/secret')).toBe('/response/[redacted]')
  })
})
