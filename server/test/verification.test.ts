import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(() => {
  testOutbox.length = 0
  return resetDatabase()
})
afterAll(closeDatabase)

const codeIn = (to: string) => {
  const mail = [...testOutbox].reverse().find((m) => m.to === to)
  return /\b(\d{6})\b/.exec(mail?.text ?? '')?.[1] ?? ''
}
const linkIn = (to: string, path: string) => {
  const mail = [...testOutbox].reverse().find((m) => m.to === to)
  return new RegExp(`${path}/([\\w-]+)`).exec(mail?.text ?? '')?.[1] ?? ''
}

/** Writes and sends a review on a link, agreeing to publish it. */
async function send(token: string, agent: ReturnType<typeof request.agent> | typeof request = request) {
  const base = `/api/invites/${token}`
  const call = agent === request ? request(app) : (agent as ReturnType<typeof request.agent>)
  const draft = await call.put(`${base}/draft`).send({ revision: 0, storyText: 'A wonderful week of yoga by the sea.', consents: { publicText: true } })
  expect(draft.status).toBe(200)
  const sent = await (agent === request ? request(app) : (agent as ReturnType<typeof request.agent>)).post(`${base}/submit`).send({ revision: draft.body.revision })
  expect(sent.status).toBe(200)
}

describe('verified reviews', () => {
  it('a review sent through the link Croot emailed is verified; one through a copied link is not', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const emailed = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: 'Asha', email: 'asha@example.test' } })
    expect((await agent.post(`/api/admin/orgs/alpha/attendees/${emailed.id}/email-invite`).set('X-CSRF-Token', csrf)).status).toBe(200)
    await send(linkIn('asha@example.test', '/invite'))
    const { token: copied } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(copied)

    const rows = await prisma.response.findMany({ include: { attendee: true, verifications: true } })
    const asha = rows.find((r) => r.attendee.name === 'Asha')!
    const ravi = rows.find((r) => r.attendee.name === 'Ravi')!
    expect(asha.verifiedAt).not.toBeNull()
    expect(asha.verifications).toMatchObject([{ method: 'email_link', addressSource: 'organiser', signals: { addressIsMember: false, joinedByGroupLink: false } }])
    expect(asha.verifications[0].emailHash).toMatch(/^[0-9a-f]{64}$/) // never the address itself
    expect(ravi.verifiedAt).toBeNull()

    // The public review shows the badge.
    await agent.post(`/api/admin/orgs/alpha/responses/${asha.id}/publish`).set('X-CSRF-Token', csrf).send({})
    const page = await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)
    expect(page.body.stories.map((s: { verified: boolean }) => s.verified)).toEqual([true])
    const story = await request(app).get(page.body.stories[0] ? `/api/public/stories/${page.body.stories[0].slug}` : '/')
    expect(story.body.story.verified).toBe(true)
  })

  it('signing in later verifies; the organiser changing the address takes the badge away', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { attendee, token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(token)
    expect((await prisma.response.findFirstOrThrow()).verifiedAt).toBeNull()

    await request(app).post('/api/auth/code/request').send({ email: 'ravi@example.test', purpose: 'signin' })
    expect((await request(app).post('/api/auth/code/verify').send({ email: 'ravi@example.test', code: codeIn('ravi@example.test') })).status).toBe(200)
    expect((await prisma.response.findFirstOrThrow({ include: { verifications: true } })).verifications).toMatchObject([{ method: 'sign_in' }])

    const { agent, csrf } = await login(user.email)
    await agent.patch(`/api/admin/orgs/alpha/attendees/${attendee.id}`).set('X-CSRF-Token', csrf).send({ email: 'ravi.new@example.test' })
    expect((await prisma.response.findFirstOrThrow()).verifiedAt).toBeNull()
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: attendee.id } })).emailVerifiedAt).toBeNull()
  })

  it('the thank-you page confirms with a code to the masked address, and signs the guest in', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(token)
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.verification).toEqual({ verified: false, canVerify: true, maskedEmail: 'r•••@example.test' })

    const sent = await request(app).post(`/api/invites/${token}/verify/send`)
    expect(sent.body.sentTo).toBe('r•••@example.test')
    expect((await request(app).post(`/api/invites/${token}/verify/confirm`).send({ code: '000000' })).status).toBe(401)
    const agent = request.agent(app)
    const ok = await agent.post(`/api/invites/${token}/verify/confirm`).send({ code: codeIn('ravi@example.test') })
    expect(ok.status).toBe(200)
    expect(ok.body.user.email).toBe('ravi@example.test')
    expect((await prisma.reviewVerification.findFirstOrThrow()).method).toBe('code')
    expect((await agent.get('/api/me/reviews')).body.reviews).toHaveLength(1) // signed in
    expect((await request(app).get(`/api/invites/${token}`)).body.verification).toMatchObject({ verified: true, canVerify: false })
  })

  it('the organiser can ask twice; the emailed link confirms only on a click, and only for that address', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(token)
    const response = await prisma.response.findFirstOrThrow()
    const ask = () => agent.post(`/api/admin/orgs/alpha/responses/${response.id}/request-verification`).set('X-CSRF-Token', csrf)

    expect((await ask()).body).toEqual({ sent: true, remaining: 1 })
    const vt = linkIn('ravi@example.test', '/verify')
    expect((await request(app).get(`/api/verify/${vt}`)).body).toMatchObject({ firstName: 'Ravi', verified: false })
    expect((await prisma.response.findFirstOrThrow()).verifiedAt).toBeNull() // opening it changes nothing
    expect((await ask()).body.remaining).toBe(0)
    expect((await ask()).status).toBe(429)

    expect((await request(app).post(`/api/verify/${vt}`)).body).toEqual({ verified: true })
    expect((await prisma.reviewVerification.findFirstOrThrow()).method).toBe('organiser_request')
    expect((await agent.get(`/api/admin/orgs/alpha/responses/${response.id}`)).body.verification).toMatchObject({ verified: true, requestsSent: 2 })
  })

  it('an emailed verification link stops working once the address changes', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { attendee, token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(token)
    const response = await prisma.response.findFirstOrThrow()
    await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/request-verification`).set('X-CSRF-Token', csrf)
    const vt = linkIn('ravi@example.test', '/verify')
    await agent.patch(`/api/admin/orgs/alpha/attendees/${attendee.id}`).set('X-CSRF-Token', csrf).send({ email: 'other@example.test' })
    expect((await request(app).post(`/api/verify/${vt}`)).status).toBe(409)
    expect((await prisma.response.findFirstOrThrow()).verifiedAt).toBeNull()
  })
})

describe('group link', () => {
  it('needs the organiser’s acknowledgement, warns the owners, and lets people join only with an email code', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const api = `/api/admin/orgs/alpha/retreats/${retreat.id}/group-link`
    expect((await agent.post(api).set('X-CSRF-Token', csrf).send({})).status).toBe(400)
    const made = await agent.post(api).set('X-CSRF-Token', csrf).send({ acknowledge: true })
    expect(made.status).toBe(200)
    expect(testOutbox.find((m) => m.to === user.email)?.text).toMatch(/Reviews must be genuine.*suspended or removed/s)
    const gt = new URL(made.body.url).pathname.split('/').pop()!

    // Joining: name and email, then the code.
    expect((await request(app).get(`/api/group/${gt}`)).body.retreatTitle).toBe(retreat.title)
    expect((await request(app).post(`/api/group/${gt}/start`).send({ name: 'Meera', email: 'Meera@Example.test' })).body.sentTo).toBe('m•••@example.test')
    expect((await request(app).post(`/api/group/${gt}/confirm`).send({ email: 'meera@example.test', code: '000000' })).status).toBe(401)
    const guest = request.agent(app)
    const joined = await guest.post(`/api/group/${gt}/confirm`).send({ email: 'meera@example.test', code: codeIn('meera@example.test') })
    expect(joined.status).toBe(200)
    const personal = joined.body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    const meera = await prisma.attendee.findFirstOrThrow({ where: { email: 'meera@example.test' } })
    expect(meera).toMatchObject({ source: 'group_link', guestListConfirmedAt: null })

    // Their review is verified, but can't be published until the organiser confirms them as a guest.
    await send(personal, guest)
    const response = await prisma.response.findFirstOrThrow({ where: { attendeeId: meera.id }, include: { verifications: true } })
    expect(response.verifiedAt).not.toBeNull()
    expect(response.verifications[0]).toMatchObject({ addressSource: 'guest', signals: { joinedByGroupLink: true, confirmedGuest: false } })
    const publish = () => agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect((await publish()).status).toBe(409)
    await agent.post(`/api/admin/orgs/alpha/attendees/${meera.id}/confirm-guest`).set('X-CSRF-Token', csrf)
    expect((await publish()).status).toBe(200)

    // Someone already on the guest list gets their own place back, not a second review.
    const { attendee: asha } = await invite(org.id, retreat.id, 'Asha', 'asha@example.test')
    await request(app).post(`/api/group/${gt}/start`).send({ name: 'Asha P', email: 'asha@example.test' })
    await request(app).post(`/api/group/${gt}/confirm`).send({ email: 'asha@example.test', code: codeIn('asha@example.test') })
    expect(await prisma.attendee.count({ where: { email: 'asha@example.test' } })).toBe(1)
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: asha.id } })).emailVerifiedAt).not.toBeNull()

    // Stopped: the link no longer works.
    await agent.delete(api).set('X-CSRF-Token', csrf)
    expect((await request(app).get(`/api/group/${gt}`)).status).toBe(404)
  })

  it('limits codes per address', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const made = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/group-link`).set('X-CSRF-Token', csrf).send({ acknowledge: true })
    const gt = new URL(made.body.url).pathname.split('/').pop()!
    testOutbox.length = 0
    for (let i = 0; i < 7; i++) await request(app).post(`/api/group/${gt}/start`).send({ name: 'Spam', email: 'spam@example.test' })
    expect(testOutbox.filter((m) => m.to === 'spam@example.test')).toHaveLength(5)
  })
})
