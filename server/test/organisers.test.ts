import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer.js'
import { ensurePlatformAdmins } from '../src/lib/platformAdmins.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
  testOutbox.length = 0
})
afterAll(closeDatabase)

async function signIn(email: string) {
  const agent = request.agent(app)
  await agent.post('/api/auth/code/request').send({ email })
  const code = /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1]
  const res = await agent.post('/api/auth/code/verify').send({ email, code })
  return { agent, csrf: res.body.csrfToken as string, body: res.body }
}

const details = {
  contactName: 'Priya Organiser',
  phone: '+44 20 7946 0000',
  orgName: 'Lakeside Wellness',
  websiteUrl: 'https://lakeside.example',
  country: 'United Kingdom',
  reviewKinds: ['property'],
  volume: 'About 40 guests a month',
  message: 'We run weekend retreats.',
  acceptTerms: true,
}

describe('signing up', () => {
  it('lets anyone create an account, which on its own grants nothing', async () => {
    const { body, agent } = await signIn('new.person@example.test')
    expect(body.created).toBe(true)
    expect(body.memberships).toEqual([])
    expect(body.user.isPlatformAdmin).toBe(false)
    expect((await agent.get('/api/platform/users')).status).toBe(403)
  })
})

describe('requesting organiser access', () => {
  it('captures details, notifies admins, and creates the organisation on approval', async () => {
    await ensurePlatformAdmins(['boss@example.test'])
    const person = await signIn('priya@example.test')

    const missing = await person.agent.post('/api/account/organiser-request').set('X-CSRF-Token', person.csrf).send({ ...details, acceptTerms: undefined })
    expect(missing.status).toBe(400)
    const sent = await person.agent.post('/api/account/organiser-request').set('X-CSRF-Token', person.csrf).send(details)
    expect(sent.status).toBe(201)
    expect(testOutbox.some((m) => m.to === 'boss@example.test' && m.subject.includes('Lakeside Wellness'))).toBe(true)
    const again = await person.agent.post('/api/account/organiser-request').set('X-CSRF-Token', person.csrf).send(details)
    expect(again.status).toBe(409)
    expect((await person.agent.get('/api/account/organiser-request')).body.request.status).toBe('pending')

    const admin = await signIn('boss@example.test')
    const list = await admin.agent.get('/api/platform/tenant-requests')
    const req = list.body.requests[0]
    expect(req).toMatchObject({ phone: '+44 20 7946 0000', country: 'United Kingdom', source: 'request' })
    const approved = await admin.agent.post(`/api/platform/tenant-requests/${req.id}/approve`).set('X-CSRF-Token', admin.csrf).send({})
    expect(approved.status).toBe(200)
    expect(approved.body.organisation.slug).toBe('lakeside-wellness')
    expect(testOutbox.some((m) => m.to === 'priya@example.test' && m.subject.includes('organiser'))).toBe(true)

    const me = await person.agent.get('/api/auth/me')
    expect(me.body.memberships).toEqual([expect.objectContaining({ slug: 'lakeside-wellness', role: 'owner' })])
    expect(me.body.user.name).toBe('Priya Organiser')
  })

  it('declines with an optional reason, which is emailed', async () => {
    await ensurePlatformAdmins(['boss@example.test'])
    const person = await signIn('priya@example.test')
    await person.agent.post('/api/account/organiser-request').set('X-CSRF-Token', person.csrf).send(details)
    const admin = await signIn('boss@example.test')
    const id = (await admin.agent.get('/api/platform/tenant-requests')).body.requests[0].id
    await admin.agent.post(`/api/platform/tenant-requests/${id}/decline`).set('X-CSRF-Token', admin.csrf).send({ reason: 'Not a retreat business' })
    expect(testOutbox.find((m) => m.to === 'priya@example.test' && m.text.includes('Not a retreat business'))).toBeTruthy()
    expect((await person.agent.get('/api/account/organiser-request')).body.request).toMatchObject({ status: 'declined', declineReason: 'Not a retreat business' })
  })
})

describe('organiser invite links', () => {
  async function createInvite(body: Record<string, unknown>) {
    await ensurePlatformAdmins(['boss@example.test'])
    const admin = await signIn('boss@example.test')
    const res = await admin.agent.post('/api/platform/organiser-invites').set('X-CSRF-Token', admin.csrf).send(body)
    expect(res.status).toBe(201)
    return { admin, url: res.body.url as string, token: (res.body.url as string).split('/').pop()! }
  }

  it('emails the link, and only the invited address can accept it', async () => {
    const { token } = await createInvite({ email: 'Invited@Example.test' })
    expect(testOutbox.some((m) => m.to === 'invited@example.test' && m.text.includes(token))).toBe(true)
    expect((await request(app).get(`/api/organiser-invites/${token}`)).body.email).toBe('invited@example.test')

    const stranger = await signIn('stranger@example.test')
    const wrong = await stranger.agent.post(`/api/organiser-invites/${token}/accept`).set('X-CSRF-Token', stranger.csrf).send(details)
    expect(wrong.status).toBe(403)

    const invited = await signIn('invited@example.test')
    const ok = await invited.agent.post(`/api/organiser-invites/${token}/accept`).set('X-CSRF-Token', invited.csrf).send(details)
    expect(ok.status).toBe(200)
    expect(ok.body.organisation.slug).toBe('lakeside-wellness')
    const reuse = await invited.agent.post(`/api/organiser-invites/${token}/accept`).set('X-CSRF-Token', invited.csrf).send(details)
    expect(reuse.status).toBe(404)
    const record = await prisma.tenantRequest.findFirstOrThrow({ where: { email: 'invited@example.test' } })
    expect(record).toMatchObject({ source: 'invite', status: 'approved', phone: '+44 20 7946 0000' })
  })

  it('can invite someone into an existing organisation with a chosen role', async () => {
    const { org } = await makeTenant('alpha')
    const { token } = await createInvite({ email: 'helper@example.test', organisationId: org.id, role: 'organiser', sendEmail: false })
    expect(testOutbox.some((m) => m.to === 'helper@example.test' && m.subject.includes('invited'))).toBe(false)
    const helper = await signIn('helper@example.test')
    await helper.agent.post(`/api/organiser-invites/${token}/accept`).set('X-CSRF-Token', helper.csrf).send({ ...details, orgName: 'Alpha' })
    const me = await helper.agent.get('/api/auth/me')
    expect(me.body.memberships).toEqual([expect.objectContaining({ slug: 'alpha', role: 'organiser' })])
  })

  it('stops working once revoked', async () => {
    const { admin, token } = await createInvite({ email: 'late@example.test', sendEmail: false })
    const id = (await admin.agent.get('/api/platform/organiser-invites')).body.invites[0].id
    await admin.agent.post(`/api/platform/organiser-invites/${id}/revoke`).set('X-CSRF-Token', admin.csrf)
    expect((await request(app).get(`/api/organiser-invites/${token}`)).status).toBe(404)
  })
})
