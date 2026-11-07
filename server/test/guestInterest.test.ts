import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  testOutbox.length = 0
  await resetDatabase()
})
afterAll(closeDatabase)

async function sendReview(token: string) {
  const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'Lovely week.' })
  const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
  expect(sent.status).toBe(200)
  return sent.body.receiptToken as string
}
const interestMails = () => testOutbox.filter((m) => m.category === 'interest')

describe('Notify me on the thank-you page', () => {
  it('an address only the organiser entered: shown masked, not typed again, and confirmed by email first', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Ravi Kumar', 'ravi@example.test')
    await sendReview(token)

    const view = await request(app).get(`/api/invites/${token}/interest`)
    expect(view.body).toMatchObject({ needsEmail: false, instant: false, status: null, orgName: 'alpha' })
    expect(view.body.maskedEmail).not.toBe('ravi@example.test')
    expect(view.body.maskedEmail).toMatch(/@example\.test$/)

    expect((await request(app).post(`/api/invites/${token}/interest`).send({})).status).toBe(400) // must tick the box
    const signed = await request(app).post(`/api/invites/${token}/interest`).send({ consent: true })
    expect(signed.body.status).toBe('pending')
    expect(interestMails().map((m) => m.to)).toEqual(['ravi@example.test'])
    expect((await prisma.interestSignup.findFirstOrThrow()).confirmedAt).toBeNull()
    expect((await request(app).get(`/api/invites/${token}/interest`)).body.status).toBe('pending')
  })

  it('a proven address (confirmed with a code, or signed in): on the list in one tap, no email', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { attendee, token } = await invite(org.id, retreat.id, 'Ravi Kumar', 'ravi@example.test')
    const receipt = await sendReview(token)
    await prisma.attendee.update({ where: { id: attendee.id }, data: { emailVerifiedAt: new Date() } })
    testOutbox.length = 0

    // From the private response page (the same steps).
    expect((await request(app).get(`/api/responses/${receipt}/interest`)).body).toMatchObject({ instant: true, status: null })
    const signed = await request(app).post(`/api/responses/${receipt}/interest`).send({ consent: true })
    expect(signed.body.status).toBe('subscribed')
    expect(interestMails()).toHaveLength(0)
    const row = await prisma.interestSignup.findFirstOrThrow()
    expect(row).toMatchObject({ email: 'ravi@example.test', name: 'Ravi', retreatId: retreat.id })
    expect(row.confirmedAt).not.toBeNull()
    expect(row.consentWording).toContain('Email me about future retreats from alpha')

    // The organiser sees them on the Interested list, and asking again changes nothing.
    expect((await request(app).post(`/api/responses/${receipt}/interest`).send({ consent: true })).body.status).toBe('subscribed')
    const { agent } = await login(user.email)
    expect((await agent.get('/api/admin/orgs/alpha/interest')).body.people).toEqual([expect.objectContaining({ email: 'ravi@example.test' })])
  })

  it('a guest with no address types one and confirms it from the email', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const attendee = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: 'Meera' } })
    const { issueInvitation } = await import('../src/lib/invites.js')
    const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: attendee.id, ttlDays: 30 })
    await sendReview(token)

    expect((await request(app).get(`/api/invites/${token}/interest`)).body).toMatchObject({ needsEmail: true, maskedEmail: null, instant: false })
    expect((await request(app).post(`/api/invites/${token}/interest`).send({ consent: true })).status).toBe(400)
    const signed = await request(app).post(`/api/invites/${token}/interest`).send({ consent: true, email: 'Meera@Example.test' })
    expect(signed.body).toMatchObject({ status: 'pending', sentTo: 'meera@example.test' })
    expect(interestMails().map((m) => m.to)).toEqual(['meera@example.test'])
  })

  it('needs the review to be sent first', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    expect((await request(app).post(`/api/invites/${token}/interest`).send({ consent: true })).status).toBe(409)
  })
})
