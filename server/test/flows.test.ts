import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, closeDatabase } from '../src/lib/prisma.js'
import { redactPath } from '../src/lib/logger.js'
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
  it('stores only the words: no identity, time or link to a response', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    // The review form tells the browser where to send it: by retreat only, never the invite token.
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.retreat.anonymousNotePath).toBe(`/api/public/notes/${retreat.id}`)
    const before = await prisma.auditEvent.count()

    const res = await request(app).post(view.body.retreat.anonymousNotePath).send({ message: 'The transfers were rushed.' })
    expect(res.status).toBe(201)
    const note = await prisma.anonymousNote.findFirstOrThrow()
    expect(Object.keys(note).sort()).toEqual(['id', 'message', 'organisationId', 'retreatId'])
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
