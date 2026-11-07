import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { newReviewEmail, testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  testOutbox.length = 0
  await resetDatabase()
})
afterAll(closeDatabase)

async function send(token: string, body: Record<string, unknown>) {
  const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, ...body })
  expect(draft.status).toBe(200)
  const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })
  expect(sent.status).toBe(200)
  return sent
}

describe('owners hear about new reviews', () => {
  it('emails every owner (not other team members) with who, the rating and the publishing choice, never the words', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const helper = await prisma.user.create({ data: { email: 'helper@alpha.test', name: 'Helper' } })
    await prisma.membership.create({ data: { userId: helper.id, organisationId: org.id, role: 'organiser' } })
    const second = await prisma.user.create({ data: { email: 'second-owner@alpha.test', name: 'Second' } })
    await prisma.membership.create({ data: { userId: second.id, organisationId: org.id, role: 'owner' } })
    const { token } = await invite(org.id, retreat.id, 'Ravi Kumar', 'ravi@example.test')
    testOutbox.length = 0

    const sent = await send(token, { storyText: 'A secret detail only for the organiser.', overallRating: 4, keepText: 'Private praise', consents: { publicText: true } })
    const mails = testOutbox.filter((m) => m.subject.startsWith('New review'))
    expect(mails.map((m) => m.to).sort()).toEqual([user.email, 'second-owner@alpha.test'].sort())
    const mail = mails[0]
    expect(mail.subject).toBe(`New review from Ravi Kumar: ${retreat.title}`)
    expect(mail.text).toContain('★★★★☆ (4 of 5)')
    expect(mail.text).toContain('They agreed to publish their story')
    expect(mail.text).toMatch(/\/admin\/alpha\/responses\/[0-9a-f-]{36}/)
    for (const m of mails) {
      expect(m.text).not.toContain('secret detail')
      expect(m.text).not.toContain('Private praise')
      expect(m.html).not.toContain('secret detail')
    }
    expect(testOutbox.some((m) => m.to === 'helper@alpha.test')).toBe(false)
    expect(sent.body.alreadySubmitted).toBe(false)

    // Asking again for the private page is not a new review: no second email.
    const before = testOutbox.length
    await request(app).post(`/api/invites/${token}/submit`).send({ revision: 0 })
    expect(testOutbox.length).toBe(before)
  })

  it('says when a guest kept their story private', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Asha', 'asha@example.test')
    testOutbox.length = 0
    await send(token, { storyText: 'Lovely week.', consents: { publicText: false } })
    const mail = testOutbox.find((m) => m.subject.startsWith('New review'))!
    expect(mail.text).toContain('They kept their story private')
    expect(mail.text).toContain('No overall rating given')
  })
})

it('an update to a sent review says so', () => {
  const m = newReviewEmail({ to: 'o@x.test', guestName: 'Ravi', retreatTitle: 'India 2026', rating: 5, publishable: true, photos: 2, updated: true, reviewUrl: 'https://croot.cx/r' })
  expect(m.subject).toBe('Ravi updated their review of India 2026')
  expect(m.text).toContain('They added 2 photos.')
  expect(m.html).toContain('★★★★★')
})
