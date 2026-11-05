import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { redactPath } from '../src/lib/logger.js'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
  testOutbox.length = 0
})
afterAll(closeDatabase)

async function signInByCode(email: string) {
  const agent = request.agent(app)
  await agent.post('/api/auth/code/request').send({ email })
  const code = /(\d{6})/.exec(testOutbox.at(-1)?.text ?? '')?.[1]
  const res = await agent.post('/api/auth/code/verify').send({ email, code })
  expect(res.status).toBe(200)
  return agent
}

describe('adding a team member', () => {
  it('never hands the owner a password link for an existing account (no account takeover)', async () => {
    const { org } = await makeTenant('alpha')
    const admin = await prisma.user.create({ data: { email: 'boss@example.test', name: 'Boss', isPlatformAdmin: true } })
    const owner = await login('alpha@owner.test')
    const res = await owner.agent
      .post(`/api/admin/orgs/${org.slug}/members`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ email: 'boss@example.test', name: 'Boss', role: 'organiser' })
    expect(res.status).toBe(201)
    expect(res.body.setupUrl).toBeNull()
    expect(await prisma.setupToken.count({ where: { userId: admin.id } })).toBe(0)
  })

  it('gives no setup link for a brand-new address either: they sign in with their email', async () => {
    const { org } = await makeTenant('alpha')
    const owner = await login('alpha@owner.test')
    const res = await owner.agent
      .post(`/api/admin/orgs/${org.slug}/members`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ email: 'new.person@example.test', name: 'New Person', role: 'organiser' })
    expect(res.status).toBe(201)
    expect(res.body.setupUrl).toBeNull()
    expect(await prisma.setupToken.count()).toBe(0)
  })
})

describe('the private response link after sending', () => {
  it('is not handed to whoever holds the invitation link; the signed-in guest gets it', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, story: '' })
    const first = await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })
    expect(first.status).toBe(200)
    expect(first.body.receiptToken).toBeTruthy()

    const forwarded = await request(app).post(`/api/invites/${token}/submit`).send({ revision: 0 })
    expect(forwarded.status).toBe(401)
    expect(forwarded.body.receiptToken).toBeUndefined()

    const guest = await signInByCode('guest@example.test')
    const again = await guest.post(`/api/invites/${token}/submit`).send({ revision: 0 })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ alreadySubmitted: true, receiptToken: first.body.receiptToken })
  })
})

describe('hardening', () => {
  it('refuses javascript: and data: web addresses', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const owner = await login('alpha@owner.test')
    for (const url of ['javascript:alert(1)', 'data:text/html,hi']) {
      const res = await owner.agent
        .patch(`/api/admin/orgs/${org.slug}/retreats/${retreat.id}`)
        .set('X-CSRF-Token', owner.csrf)
        .send({ itineraryUrl: url })
      expect(res.status).toBe(400)
    }
  })

  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request(app).post('/api/auth/code/request').set('Content-Type', 'application/json').send('{"email":')
    expect(res.status).toBe(400)
  })

  it('redacts album and organiser-invite tokens from logged paths', () => {
    expect(redactPath('/api/albums/abcdefabcdefabcdefabcdef/photos')).toBe('/api/albums/[redacted]/photos')
    expect(redactPath('/api/organiser-invites/abcdefabcdef')).toBe('/api/organiser-invites/[redacted]')
  })

  it('rejects a receipt album upload with a bad link before reading the file', async () => {
    const res = await request(app).post('/api/responses/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/album/photos').attach('photo', Buffer.alloc(1024), 'x.jpg')
    expect(res.status).toBe(404)
  })
})
