import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { runRetention } from '../src/jobs/retention.js'
import { hashPassword } from '../src/lib/password.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

const DAY = 86_400_000

async function submitted(token: string, story = 'A calm and kind week.', consents: Record<string, boolean> = { publicText: true }) {
  const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: story, keepText: 'PRIVATE-KEEP', consents })
  const res = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
  return res.body.receiptToken as string
}

describe('guest rights', () => {
  it('lets a guest download their data, without anonymous notes', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Anika Example')
    await request(app).post('/api/public/orgs/alpha/retreats/trip/anonymous').send({ message: 'ANON-TEXT here' })
    const receipt = await submitted(token)
    const res = await request(app).get(`/api/responses/${receipt}/export`)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    const data = JSON.parse(res.text)
    expect(data.you.email).toBe('guest@example.test')
    expect(data.response.privateFeedback.keep).toBe('PRIVATE-KEEP')
    expect(res.text).not.toContain('ANON-TEXT')
  })

  it('erases a guest completely, takes down their story and keeps no personal data in the audit log', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { token } = await invite(org.id, retreat.id, 'Anika Example')
    const receipt = await submitted(token)
    const response = await prisma.response.findFirstOrThrow()
    const pub = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})

    expect((await request(app).post(`/api/responses/${receipt}/erase`).send({ confirm: 'nope' })).status).toBe(400)
    expect((await request(app).post(`/api/responses/${receipt}/erase`).send({ confirm: 'DELETE' })).status).toBe(200)

    expect(await prisma.attendee.count()).toBe(0)
    expect(await prisma.response.count()).toBe(0)
    expect(await prisma.publicationRevision.count()).toBe(0)
    expect(await prisma.invitation.count()).toBe(0)
    expect((await request(app).get(`/api/public/stories/${pub.body.publicSlug}`)).status).toBe(410)
    expect((await request(app).get(`/api/responses/${receipt}`)).status).toBe(404)
    const events = JSON.stringify(await prisma.auditEvent.findMany())
    expect(events).toContain('guest.erased')
    expect(events).not.toContain('Anika')
    expect(events).not.toContain('guest@example.test')
  })

  it('lets only owners erase a guest from the workspace, with a reason', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const organiser = await prisma.user.create({ data: { email: 'org@alpha.test', name: 'Organiser', passwordHash: await hashPassword('correct horse battery') } })
    await prisma.membership.create({ data: { userId: organiser.id, organisationId: org.id, role: 'organiser' } })
    const { attendee } = await invite(org.id, retreat.id)
    const { agent, csrf } = await login('org@alpha.test')
    expect((await agent.get(`/api/admin/orgs/alpha/attendees/${attendee.id}/export`)).status).toBe(200)
    const denied = await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/erase`).set('X-CSRF-Token', csrf).send({ confirm: 'DELETE', reason: 'request' })
    expect(denied.status).toBe(403)
    const owner = await login('alpha@owner.test')
    const ok = await owner.agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/erase`).set('X-CSRF-Token', owner.csrf).send({ confirm: 'DELETE', reason: 'email request' })
    expect(ok.status).toBe(200)
    expect(await prisma.attendee.count()).toBe(0)
  })
})

describe('retention', () => {
  it('applies each rule and keeps only what a guest agreed to publish', async () => {
    const { org, user, retreat } = await makeTenant('alpha') // itinerary ended 2026-11-01
    const { agent, csrf } = await login(user.email)
    const now = new Date('2029-01-01T00:00:00Z') // > 24 months after submission, > 180 days after the retreat

    // Published guest → minimised, story stays public.
    const pubGuest = await invite(org.id, retreat.id, 'Published Guest', 'pub@example.test')
    await submitted(pubGuest.token, 'Keep this story.')
    const pubResponse = await prisma.response.findFirstOrThrow({ where: { attendeeId: pubGuest.attendee.id } })
    const pub = await agent.post(`/api/admin/orgs/alpha/responses/${pubResponse.id}/publish`).set('X-CSRF-Token', csrf).send({})
    // Unpublished guest → erased.
    const privGuest = await invite(org.id, retreat.id, 'Private Guest', 'priv@example.test')
    await submitted(privGuest.token, '', {})
    // Never responded → erased.
    await invite(org.id, retreat.id, 'Silent Guest', 'silent@example.test')
    // Old anonymous note → deleted.
    await prisma.anonymousNote.create({ data: { organisationId: org.id, retreatId: retreat.id, message: 'old', receivedWeek: new Date('2026-11-02') } })
    await prisma.response.updateMany({ data: { submittedAt: new Date(now.getTime() - 800 * DAY) } })

    const counts = await runRetention(now)
    expect(counts.responsesMinimised).toBe(1)
    expect(counts.responsesErased).toBe(1)
    expect(counts.nonResponders).toBe(1)
    expect(counts.notes).toBe(1)

    const kept = await prisma.response.findUniqueOrThrow({ where: { id: pubResponse.id }, include: { attendee: true, ratings: true } })
    expect(kept.keepText).toBe('')
    expect(kept.ratings).toHaveLength(0)
    expect(kept.attendee.email).not.toContain('pub@example.test')
    expect(kept.privateDataPurgedAt).not.toBeNull()
    expect(await prisma.attendee.count()).toBe(1)
    expect((await request(app).get(`/api/public/stories/${pub.body.publicSlug}`)).status).toBe(200)

    // Idempotent.
    const again = await runRetention(now)
    expect(again.responsesMinimised + again.responsesErased + again.nonResponders).toBe(0)
  })

  it('deletes stale drafts but leaves recent ones', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const a = await invite(org.id, retreat.id, 'A', 'a@example.test')
    const b = await invite(org.id, retreat.id, 'B', 'b@example.test')
    await request(app).put(`/api/invites/${a.token}/draft`).send({ revision: 0, storyText: 'old draft' })
    await request(app).put(`/api/invites/${b.token}/draft`).send({ revision: 0, storyText: 'new draft' })
    const old = await prisma.response.findFirstOrThrow({ where: { attendeeId: a.attendee.id } })
    await prisma.$executeRaw`UPDATE "Response" SET "updatedAt" = ${new Date(Date.now() - 100 * DAY)} WHERE id = ${old.id}::uuid`
    const counts = await runRetention(new Date())
    expect(counts.drafts).toBe(1)
    expect(await prisma.response.count()).toBe(1)
  })
})

describe('transparency and processor duties', () => {
  it('requires access requesters to acknowledge the privacy notice and processing terms', async () => {
    const body = { orgName: 'Lakeside', contactName: 'Sam', email: 'sam@lakeside.test', reviewKinds: ['property'] }
    expect((await request(app).post('/api/public/tenant-requests').send(body)).status).toBe(400)
    expect((await request(app).post('/api/public/tenant-requests').send({ ...body, acceptTerms: true })).status).toBe(201)
    expect((await prisma.tenantRequest.findFirstOrThrow()).termsVersion).toBeTruthy()
  })

  it('publishes a privacy notice built from the controller settings', async () => {
    const { org } = await makeTenant('alpha')
    await prisma.organisation.update({ where: { id: org.id }, data: { legalName: 'Alpha Ltd', responseRetentionMonths: 12 } })
    const res = await request(app).get('/api/public/orgs/alpha/privacy')
    expect(res.status).toBe(200)
    expect(res.body.controller.legalName).toBe('Alpha Ltd')
    expect(res.body.controller.responseRetentionMonths).toBe(12)
    expect(res.body.controller.id).toBeUndefined()
  })

  it('audits platform-admin access to a tenant, and can erase a whole tenant', async () => {
    const { org } = await makeTenant('alpha')
    await invite(org.id, (await prisma.retreat.findFirstOrThrow()).id)
    const admin = await prisma.user.create({ data: { email: 'ops@croot.test', name: 'Ops', isPlatformAdmin: true, passwordHash: await hashPassword('correct horse battery') } })
    const { agent, csrf } = await login(admin.email)
    expect((await agent.get('/api/admin/orgs/alpha')).status).toBe(200)
    expect(await prisma.auditEvent.count({ where: { action: 'platform.tenant_access', organisationId: org.id } })).toBe(1)

    expect((await agent.post(`/api/platform/orgs/${org.id}/erase`).set('X-CSRF-Token', csrf).send({ confirmSlug: 'wrong' })).status).toBe(400)
    expect((await agent.post(`/api/platform/orgs/${org.id}/erase`).set('X-CSRF-Token', csrf).send({ confirmSlug: 'alpha' })).status).toBe(200)
    expect(await prisma.organisation.count()).toBe(0)
    expect(await prisma.attendee.count()).toBe(0)
    expect(await prisma.user.count({ where: { email: 'alpha@owner.test' } })).toBe(0)
    expect(await prisma.user.count({ where: { id: admin.id } })).toBe(1)
  })
})
