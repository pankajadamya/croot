import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { issueInvitation } from '../src/lib/invites.js'
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
/** Moves earlier codes back a minute, past the gap before another may be asked for. */
const aMinuteLater = async () => {
  const past = new Date(Date.now() - 61_000)
  await prisma.groupJoinCode.updateMany({ data: { createdAt: past } })
  await prisma.loginCode.updateMany({ data: { createdAt: past } })
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

  it('signing in later needs "Yes, this review is mine"; the organiser changing the address takes the badge away', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { attendee, token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(token)
    expect((await prisma.response.findFirstOrThrow()).verifiedAt).toBeNull()

    // Signing in alone doesn't vouch for a review someone may have written on a copied link…
    const ravi = request.agent(app)
    await ravi.post('/api/auth/code/request').send({ email: 'ravi@example.test', purpose: 'signin' })
    const signedIn = await ravi.post('/api/auth/code/verify').send({ email: 'ravi@example.test', code: codeIn('ravi@example.test') })
    expect(signedIn.status).toBe(200)
    expect((await prisma.response.findFirstOrThrow()).verifiedAt).toBeNull()
    const mine = (await ravi.get('/api/me/reviews')).body.reviews[0]
    expect(mine).toMatchObject({ canClaim: true, verified: false })
    // …the guest saying it's theirs does.
    expect((await ravi.post(`/api/me/reviews/${attendee.id}/claim`).set('X-CSRF-Token', signedIn.body.csrfToken)).status).toBe(200)
    expect((await prisma.response.findFirstOrThrow({ include: { verifications: true } })).verifications).toMatchObject([{ method: 'sign_in' }])
    expect((await ravi.get('/api/me/reviews')).body.reviews[0]).toMatchObject({ canClaim: false, verified: true })

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
    expect(view.body.verification).toEqual({ verified: false, canVerify: true, maskedEmail: 'r•••@example.test', needsEmail: false })

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
  async function makeLink() {
    const t = await makeTenant('alpha')
    const { agent, csrf } = await login(t.user.email)
    const api = `/api/admin/orgs/alpha/retreats/${t.retreat.id}/group-link`
    expect((await agent.post(api).set('X-CSRF-Token', csrf).send({})).status).toBe(400) // must acknowledge
    const made = await agent.post(api).set('X-CSRF-Token', csrf).send({ acknowledge: true })
    expect(made.status).toBe(200)
    return { ...t, agent, csrf, api, gt: new URL(made.body.url).pathname.split('/').pop()! }
  }
  const join = (gt: string, name: string) => request(app).post(`/api/group/${gt}/join`).send({ name })

  it('asks only for a name; the email is optional, on the thank-you page; publishing waits for the organiser', async () => {
    const { user, agent, csrf, gt } = await makeLink()
    expect(testOutbox.find((m) => m.to === user.email)?.text).toMatch(/up to 20 people.*Reviews must be genuine.*suspended or removed/s)

    const joined = await join(gt, 'Meera')
    expect(joined.status).toBe(201)
    const token = joined.body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    const meera = await prisma.attendee.findFirstOrThrow({ where: { name: 'Meera' } })
    expect(meera).toMatchObject({ source: 'group_link', email: null, guestListConfirmedAt: null })

    await send(token)
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.verification).toEqual({ verified: false, canVerify: true, maskedEmail: null, needsEmail: true })

    // Optional verification on the thank-you page: they give an email, then the code.
    expect((await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'Meera@Example.test' })).body.sentTo).toBe('meera@example.test')
    expect((await request(app).post(`/api/invites/${token}/verify/confirm`).send({ email: 'meera@example.test', code: '000000' })).status).toBe(401)
    const guest = request.agent(app)
    const ok = await guest.post(`/api/invites/${token}/verify/confirm`).send({ email: 'meera@example.test', code: codeIn('meera@example.test') })
    expect(ok.status).toBe(200)
    const response = await prisma.response.findFirstOrThrow({ where: { attendeeId: meera.id }, include: { verifications: true, attendee: true } })
    expect(response.attendee.email).toBe('meera@example.test')
    expect(response.verifiedAt).not.toBeNull()
    expect(response.verifications[0]).toMatchObject({ method: 'code', addressSource: 'guest', signals: { joinedByGroupLink: true, confirmedGuest: false } })
    expect((await guest.get('/api/me/reviews')).body.reviews).toHaveLength(1) // signed in to manage it

    const publish = () => agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect((await publish()).status).toBe(409)
    await agent.post(`/api/admin/orgs/alpha/attendees/${meera.id}/confirm-guest`).set('X-CSRF-Token', csrf)
    expect((await publish()).status).toBe(200)
  })

  it('won’t take an email that already has its own sent review on the retreat', async () => {
    const { org, retreat, gt } = await makeLink()
    const { token: ashaOwn } = await invite(org.id, retreat.id, 'Asha', 'asha@example.test')
    await send(ashaOwn)
    const token = (await join(gt, 'Asha again')).body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    await send(token)
    expect((await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'asha@example.test' })).status).toBe(409)
  })

  it('matches a joiner to their place on the guest list when they confirm that email', async () => {
    const { org, retreat, agent, csrf, gt } = await makeLink()
    const { attendee: asha, token: ashaLink } = await invite(org.id, retreat.id, 'Asha Patel', 'asha@example.test')
    // Asha had opened her own link and started a draft; then she wrote her review on the group link.
    await request(app).put(`/api/invites/${ashaLink}/draft`).send({ revision: 0, storyText: 'Half a thought' })
    const token = (await join(gt, 'Asha')).body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    await send(token)
    await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'asha@example.test' })
    const guest = request.agent(app)
    const ok = await guest.post(`/api/invites/${token}/verify/confirm`).send({ email: 'asha@example.test', code: codeIn('asha@example.test') })
    expect(ok.status).toBe(200)
    expect(ok.body.movedTo).toBe(`/my-reviews/${asha.id}`)

    // One guest, on the list, with the review she sent (her draft replaced), verified and publishable.
    expect(await prisma.attendee.count({ where: { retreatId: retreat.id } })).toBe(1)
    const response = await prisma.response.findFirstOrThrow({ include: { attendee: true } })
    expect(response).toMatchObject({ attendeeId: asha.id, storyText: 'A wonderful week of yoga by the sea.' })
    expect(response.verifiedAt).not.toBeNull()
    expect(response.attendee).toMatchObject({ source: 'invited', email: 'asha@example.test' })
    expect((await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})).status).toBe(200)
    expect((await guest.get('/api/me/reviews')).body.reviews).toMatchObject([{ attendeeId: asha.id, verified: true }])
    // Her own link still works, and shows the sent review.
    expect((await request(app).get(`/api/invites/${ashaLink}`)).body.response.status).toBe('submitted')
  })

  it('lets one joiner try at most 3 addresses', async () => {
    const { gt } = await makeLink()
    const token = (await join(gt, 'Typo')).body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    await send(token)
    for (const e of ['a@x.test', 'b@x.test', 'c@x.test']) {
      expect((await request(app).post(`/api/invites/${token}/verify/send`).send({ email: e })).status).toBe(200)
      await aMinuteLater()
    }
    expect((await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'd@x.test' })).status).toBe(429)
    expect((await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'a@x.test' })).status).toBe(200) // a new code for one already tried
  })

  it('takes at most 20 people', async () => {
    const { gt } = await makeLink()
    for (let i = 0; i < 20; i++) expect((await join(gt, `Guest ${i}`)).status).toBe(201)
    const over = await join(gt, 'One too many')
    expect(over.status).toBe(409)
    expect(over.body.error).toMatch(/used by 20 people.*contact/)
    expect((await request(app).get(`/api/group/${gt}`)).body.full).toBe(true)
  })

  it('lasts as long as the organiser chooses, from 1 hour to 7 days', async () => {
    const { retreat, agent, csrf, api } = await makeLink()
    const lifetime = async () => {
      const r = await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })
      return Math.round((r.groupLinkExpiresAt!.getTime() - r.groupLinkCreatedAt!.getTime()) / 3_600_000)
    }
    expect(await lifetime()).toBe(168) // the default: 7 days
    expect((await agent.post(api).set('X-CSRF-Token', csrf).send({ acknowledge: true, hours: 1 })).status).toBe(200)
    expect(await lifetime()).toBe(1)
    expect((await agent.post(api).set('X-CSRF-Token', csrf).send({ acknowledge: true, hours: 169 })).status).toBe(400)
    expect((await agent.post(api).set('X-CSRF-Token', csrf).send({ acknowledge: true, hours: 0 })).status).toBe(400)
  })

  it('after it runs out, points people to the organiser; a stopped link is gone', async () => {
    const { retreat, agent, csrf, api, gt } = await makeLink()
    const live = await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })
    const days = (live.groupLinkExpiresAt!.getTime() - live.groupLinkCreatedAt!.getTime()) / 86_400_000
    expect(Math.round(days)).toBe(7)
    await prisma.retreat.update({ where: { id: retreat.id }, data: { groupLinkExpiresAt: new Date(Date.now() - 1000) } })
    const expired = await request(app).get(`/api/group/${gt}`)
    expect(expired.status).toBe(410)
    expect(expired.body.error).toMatch(/expired\. Please contact .* for a new link/)
    expect((await join(gt, 'Late')).status).toBe(410)

    await agent.delete(api).set('X-CSRF-Token', csrf)
    expect((await request(app).get(`/api/group/${gt}`)).status).toBe(404)
  })

  it('limits verification codes per address', async () => {
    const { gt } = await makeLink()
    const token = (await join(gt, 'Spam')).body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    await send(token)
    testOutbox.length = 0
    for (let i = 0; i < 7; i++) {
      await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'spam@example.test' })
      await aMinuteLater()
    }
    expect(testOutbox.filter((m) => m.to === 'spam@example.test')).toHaveLength(5)
  })
})

describe('verifying right after sending (the private response page)', () => {
  it('offers the step on the page guests land on after Send, for invited and group-link guests alike', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'Lovely.' })
    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    const receipt = `/api/responses/${sent.body.receiptToken}`

    expect((await request(app).get(receipt)).body.verification).toEqual({ verified: false, canVerify: true, maskedEmail: 'r•••@example.test', needsEmail: false })
    expect((await request(app).post(`${receipt}/verify/send`)).body.sentTo).toBe('r•••@example.test')
    const ok = await request(app).post(`${receipt}/verify/confirm`).send({ code: codeIn('ravi@example.test') })
    expect(ok.status).toBe(200)
    expect((await request(app).get(receipt)).body.verification).toMatchObject({ verified: true, canVerify: false })
    expect((await prisma.reviewVerification.findFirstOrThrow()).method).toBe('code')
  })

  it('a group-link guest types their email there, and is matched to the guest list', async () => {
    const t = await makeTenant('alpha')
    const { agent, csrf } = await login(t.user.email)
    const made = await agent.post(`/api/admin/orgs/alpha/retreats/${t.retreat.id}/group-link`).set('X-CSRF-Token', csrf).send({ acknowledge: true })
    const gt = new URL(made.body.url).pathname.split('/').pop()!
    const { attendee: meera } = await invite(t.org.id, t.retreat.id, 'Meera', 'meera@example.test')
    const token = (await request(app).post(`/api/group/${gt}/join`).send({ name: 'Meera' })).body.reviewPath.match(/\/invite\/([\w-]+)/)[1]
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'Lovely.' })
    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    const receipt = `/api/responses/${sent.body.receiptToken}`

    expect((await request(app).get(receipt)).body.verification).toMatchObject({ canVerify: true, maskedEmail: null, needsEmail: true })
    await request(app).post(`${receipt}/verify/send`).send({ email: 'meera@example.test' })
    const ok = await request(app).post(`${receipt}/verify/confirm`).send({ email: 'meera@example.test', code: codeIn('meera@example.test') })
    expect(ok.body.movedTo).toBe(`/my-reviews/${meera.id}`)
    // The private response link still works after the match (it belongs to the review, not the joiner).
    expect((await request(app).get(receipt)).body.verification).toMatchObject({ verified: true })
    expect(await prisma.attendee.count()).toBe(1)
  })
})

describe('guests without an email on file', () => {
  it('a guest the organiser added without an email can add and confirm one after sending', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const ravi = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: 'Ravi' } })
    const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: ravi.id, ttlDays: 30 })
    const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'Lovely.' })
    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
    const receipt = `/api/responses/${sent.body.receiptToken}`

    // Offered on both pages, asking for the address.
    expect((await request(app).get(receipt)).body.verification).toEqual({ verified: false, canVerify: true, maskedEmail: null, needsEmail: true })
    expect((await request(app).get(`/api/invites/${token}`)).body.verification).toMatchObject({ canVerify: true, needsEmail: true })

    expect((await request(app).post(`${receipt}/verify/send`).send({ email: 'Ravi@Example.test' })).body.sentTo).toBe('ravi@example.test')
    const ok = await request(app).post(`${receipt}/verify/confirm`).send({ email: 'ravi@example.test', code: codeIn('ravi@example.test') })
    expect(ok.status).toBe(200)
    expect(ok.body.movedTo).toBeUndefined() // same guest, now with their email
    const after = await prisma.attendee.findUniqueOrThrow({ where: { id: ravi.id }, include: { response: { include: { verifications: true } } } })
    expect(after.email).toBe('ravi@example.test')
    expect(after.response!.verifications[0]).toMatchObject({ method: 'code', addressSource: 'guest' }) // the guest typed it
    // The organiser sees the address on their guest list now, and Ravi can sign in to manage the review.
    const { agent } = await login(user.email)
    const list = (await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/attendees`)).body.attendees
    expect(list[0]).toMatchObject({ name: 'Ravi', email: 'ravi@example.test', verified: true })
  })
})

describe('asking for a new code', () => {
  it('waits a minute between codes and says how long a code lasts; a typed address can be corrected', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const ravi = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: 'Ravi' } })
    const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: ravi.id, ttlDays: 30 })
    await send(token)
    const first = await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'ravi@exmaple.test' }) // a typo
    expect(first.body).toEqual({ sentTo: 'ravi@exmaple.test', validMinutes: 10, resendSeconds: 60 })
    const tooSoon = await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'ravi@example.test' })
    expect(tooSoon.status).toBe(429)
    expect(tooSoon.body.error).toMatch(/wait a minute/)
    await aMinuteLater()
    // Corrected: the code goes to the right address, and that's the one that's confirmed.
    expect((await request(app).post(`/api/invites/${token}/verify/send`).send({ email: 'ravi@example.test' })).body.sentTo).toBe('ravi@example.test')
    expect((await request(app).post(`/api/invites/${token}/verify/confirm`).send({ email: 'ravi@example.test', code: codeIn('ravi@example.test') })).status).toBe(200)
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: ravi.id } })).email).toBe('ravi@example.test')
  })
})
