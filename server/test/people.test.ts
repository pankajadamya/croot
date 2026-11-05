import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer.js'
import { configuredAdminEmails, ensurePlatformAdmins } from '../src/lib/platformAdmins.js'
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
  const code = /(\d{6})/.exec(testOutbox.at(-1)?.text ?? '')?.[1]
  const res = await agent.post('/api/auth/code/verify').send({ email, code })
  return { agent, csrf: res.body.csrfToken as string, body: res.body }
}

describe('super admins from settings', () => {
  it('parses, normalises and de-duplicates the configured list', () => {
    expect(configuredAdminEmails(' Boss@Example.test, boss@example.test ,not-an-email,')).toEqual(['boss@example.test'])
  })

  it('creates the account with super admin rights, who can then sign in with an email code', async () => {
    expect(await ensurePlatformAdmins(['boss@example.test'])).toEqual(['boss@example.test'])
    expect(await ensurePlatformAdmins(['boss@example.test'])).toEqual([]) // idempotent
    const { body } = await signIn('boss@example.test')
    expect(body.user.isPlatformAdmin).toBe(true)
  })

  it('never demotes: removing an address from the setting keeps access', async () => {
    await ensurePlatformAdmins(['boss@example.test'])
    await ensurePlatformAdmins([])
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'boss@example.test' } })).isPlatformAdmin).toBe(true)
  })
})

describe('making people organisers', () => {
  it('lets a super admin give a guest organiser access, after which they get the workspace', async () => {
    const { org } = await makeTenant('alpha')
    await ensurePlatformAdmins(['boss@example.test'])
    const admin = await signIn('boss@example.test')

    const added = await admin.agent.post('/api/platform/users').set('X-CSRF-Token', admin.csrf).send({ email: 'Helper@Example.test' })
    expect(added.status).toBe(201)
    const helper = added.body.user
    expect(helper.email).toBe('helper@example.test')

    const grant = await admin.agent
      .post(`/api/platform/users/${helper.id}/memberships`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ organisationId: org.id, role: 'organiser' })
    expect(grant.status).toBe(201)
    expect(grant.body.user.memberships[0]).toMatchObject({ role: 'organiser', organisation: { slug: 'alpha' } })

    const signedIn = await signIn('helper@example.test')
    expect(signedIn.body.memberships).toEqual([expect.objectContaining({ slug: 'alpha', role: 'organiser' })])
    expect((await signedIn.agent.get('/api/admin/orgs/alpha')).status).toBe(200)
  })

  it('can create a new organisation with the person as owner', async () => {
    await ensurePlatformAdmins(['boss@example.test'])
    const admin = await signIn('boss@example.test')
    const person = (await admin.agent.post('/api/platform/users').set('X-CSRF-Token', admin.csrf).send({ email: 'owner@lakeside.test' })).body.user
    const res = await admin.agent
      .post(`/api/platform/users/${person.id}/memberships`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ newOrganisationName: 'Lakeside Wellness' })
    expect(res.status).toBe(201)
    expect(res.body.user.memberships[0]).toMatchObject({ role: 'owner', organisation: { name: 'Lakeside Wellness', slug: 'lakeside-wellness' } })
  })

  it('keeps guardrails: no self-demotion, no orphaned organisation, admins only', async () => {
    const { org, user: owner } = await makeTenant('alpha')
    await ensurePlatformAdmins(['boss@example.test'])
    const admin = await signIn('boss@example.test')
    const me = admin.body.user.id
    expect((await admin.agent.patch(`/api/platform/users/${me}`).set('X-CSRF-Token', admin.csrf).send({ isPlatformAdmin: false })).status).toBe(409)
    const ownerMembership = await prisma.membership.findFirstOrThrow({ where: { organisationId: org.id, userId: owner.id } })
    const orphan = await admin.agent.delete(`/api/platform/users/${owner.id}/memberships/${ownerMembership.id}`).set('X-CSRF-Token', admin.csrf)
    expect(orphan.status).toBe(409)

    const nonAdmin = await signIn('alpha@owner.test')
    expect((await nonAdmin.agent.get('/api/platform/users')).status).toBe(403)
  })
})
