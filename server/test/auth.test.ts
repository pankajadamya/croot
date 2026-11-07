import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
  testOutbox.length = 0
})
afterAll(closeDatabase)

const lastCode = () => /(\d{6})/.exec(testOutbox.at(-1)?.text ?? '')?.[1]

async function signInWithCode(email: string) {
  const agent = request.agent(app)
  await agent.post('/api/auth/code/request').send({ email })
  const code = lastCode()
  const res = await agent.post('/api/auth/code/verify').send({ email, code })
  return { agent, res, csrf: res.body.csrfToken as string }
}

describe('email codes', () => {
  it('answers identically for known and new addresses (no account enumeration)', async () => {
    await makeTenant('alpha') // creates alpha@owner.test
    const known = await request(app).post('/api/auth/code/request').send({ email: 'alpha@owner.test' })
    const unknown = await request(app).post('/api/auth/code/request').send({ email: 'nobody@example.test' })
    expect(known.body).toEqual(unknown.body)
    // Account sign-up is open: a new address gets a code that creates its (permission-less) account.
    expect(testOutbox.map((m) => m.to)).toEqual(['alpha@owner.test', 'nobody@example.test'])
    expect(testOutbox[0].text).toContain('sign in')
    expect(testOutbox[1].text).toContain('creating your Croot account')
  })

  it('signs in with a valid code, once only', async () => {
    await makeTenant('alpha')
    const { agent, res } = await signInWithCode('alpha@owner.test')
    expect(res.status).toBe(200)
    expect(res.body.memberships[0].slug).toBe('alpha')
    expect((await agent.get('/api/auth/me')).status).toBe(200)
    const reuse = await request(app).post('/api/auth/code/verify').send({ email: 'alpha@owner.test', code: lastCode() })
    expect(reuse.status).toBe(401)
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'alpha@owner.test' } })).emailVerifiedAt).not.toBeNull()
  })

  it('kills a code after five wrong guesses', async () => {
    await makeTenant('alpha')
    await request(app).post('/api/auth/code/request').send({ email: 'alpha@owner.test' })
    const code = lastCode()!
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/code/verify').send({ email: 'alpha@owner.test', code: wrong })
    expect((await request(app).post('/api/auth/code/verify').send({ email: 'alpha@owner.test', code })).status).toBe(401)
  })

  it('stores only a keyed hash of the code', async () => {
    await makeTenant('alpha')
    await request(app).post('/api/auth/code/request').send({ email: 'alpha@owner.test' })
    const row = await prisma.loginCode.findFirstOrThrow()
    expect(row.codeHash).not.toContain(lastCode()!)
    expect(row.codeHash).toHaveLength(64)
  })
})

describe('accounts', () => {
  it('gives a new account no organiser access, and refuses the organiser self-sign-up purpose while it is off', async () => {
    const { org, retreat } = await makeTenant('alpha')
    await invite(org.id, retreat.id, 'Guest', 'guest@example.test')
    await request(app).post('/api/auth/code/request').send({ email: 'stranger@example.test', purpose: 'signup' })
    expect(testOutbox).toHaveLength(0)
    const { res } = await signInWithCode('guest@example.test')
    expect(res.status).toBe(200)
    expect(res.body.created).toBe(true)
    expect(res.body.memberships).toEqual([])
  })

  it('does not let anyone create an organisation while organiser sign-up is off', async () => {
    const { org, retreat } = await makeTenant('alpha')
    await invite(org.id, retreat.id, 'Guest', 'guest@example.test')
    const { agent, csrf } = await signInWithCode('guest@example.test')
    const res = await agent.post('/api/account/organisations').set('X-CSRF-Token', csrf).send({ name: 'My Retreats', acceptTerms: true })
    expect(res.status).toBe(403)
  })

  it('hides Google sign-in when it is not configured', async () => {
    const res = await request(app).get('/api/auth/providers')
    expect(res.body).toMatchObject({ google: false, emailCode: true, organiserSignup: false })
    expect((await request(app).get('/api/auth/google/start')).status).toBe(404)
  })
})

describe('guest reviews: link or sign-in', () => {
  async function sentReview() {
    const { org, retreat } = await makeTenant('alpha')
    const { attendee, token } = await invite(org.id, retreat.id, 'Guest', 'guest@example.test')
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'First words.' })
    await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    return { attendee, token }
  }

  it('resumes a draft by link without signing in', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const a = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'Half written' })
    expect(a.status).toBe(200)
    const resumed = await request(app).get(`/api/invites/${token}`)
    expect(resumed.body.response.storyText).toBe('Half written')
    expect(resumed.body.signIn.required).toBe(false)
  })

  it('lets the guest change a sent review on their own private link, without signing in', async () => {
    const { token } = await sentReview()
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.editable).toBe(false) // sent: reopened first, so the published version stays until approved
    expect(view.body.signIn).toMatchObject({ required: false, signedIn: false, mayChange: true, canReopen: true })
    expect((await request(app).post(`/api/invites/${token}/reopen`)).status).toBe(200)
    const open = await request(app).get(`/api/invites/${token}`)
    expect(open.body.editable).toBe(true)
    const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: open.body.response.revision, storyText: 'Changed on my link.' })
    expect(saved.status).toBe(200)
    expect((await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })).status).toBe(200)
    expect((await prisma.response.findFirstOrThrow()).storyText).toBe('Changed on my link.')
    // The private response page (export, erase) still needs sign-in: a link can be forwarded.
    const again = await request(app).post(`/api/invites/${token}/submit`).send({ revision: 0 })
    expect(again.status).toBe(401)
  })

  it('stops a revoked link from changing a sent review', async () => {
    const { token } = await sentReview()
    await prisma.invitation.updateMany({ data: { revokedAt: new Date() } })
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(404)
    expect((await request(app).post(`/api/invites/${token}/reopen`)).status).toBe(404)
  })

  it('lets the invited guest sign in, find the review and change it', async () => {
    const { attendee } = await sentReview()
    const { agent, csrf } = await signInWithCode('guest@example.test')
    const mine = await agent.get('/api/me/reviews')
    expect(mine.body.reviews).toHaveLength(1)
    expect(mine.body.reviews[0]).toMatchObject({ attendeeId: attendee.id, status: 'submitted' })

    const base = `/api/me/reviews/${attendee.id}`
    expect((await agent.post(`${base}/reopen`).set('X-CSRF-Token', csrf)).status).toBe(200)
    const view = await agent.get(base)
    expect(view.body.editable).toBe(true)
    const saved = await agent.put(`${base}/draft`).set('X-CSRF-Token', csrf).send({ revision: view.body.response.revision, storyText: 'Updated words.' })
    expect(saved.status).toBe(200)
    const sent = await agent.post(`${base}/submit`).set('X-CSRF-Token', csrf).send({ revision: saved.body.revision })
    expect(sent.status).toBe(200)
    expect((await prisma.response.findFirstOrThrow()).storyText).toBe('Updated words.')
  })

  it('never shows one person another person’s reviews', async () => {
    const { attendee } = await sentReview()
    const { org, retreat } = { org: await prisma.organisation.findFirstOrThrow(), retreat: await prisma.retreat.findFirstOrThrow() }
    await invite(org.id, retreat.id, 'Other', 'other@example.test')
    const { agent } = await signInWithCode('other@example.test')
    expect((await agent.get('/api/me/reviews')).body.reviews).toHaveLength(1)
    expect((await agent.get(`/api/me/reviews/${attendee.id}`)).status).toBe(404)
  })

  it('requires CSRF for signed-in changes', async () => {
    const { attendee } = await sentReview()
    const { agent } = await signInWithCode('guest@example.test')
    expect((await agent.post(`/api/me/reviews/${attendee.id}/reopen`)).status).toBe(403)
  })
})
