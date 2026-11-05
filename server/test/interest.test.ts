import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { runRetention } from '../src/jobs/retention.js'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
  testOutbox.length = 0
})
afterAll(closeDatabase)

const tokenFrom = (text: string, kind: 'confirm' | 'unsubscribe') => {
  const m = text.match(kind === 'confirm' ? /\/interest\/([\w-]+)(?!\/unsubscribe)\b/ : /\/interest\/([\w-]+)\/unsubscribe/)
  return m![1]
}

describe('register interest in the next retreat', () => {
  it('double opt-in: nothing is emailed to the list until the visitor confirms', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const signUp = (email: string, consent: unknown = true) => request(app).post('/api/public/orgs/alpha/interest').send({ email, name: 'Ana', retreatSlug: retreat.slug, consent })

    expect((await signUp('ana@example.test', false)).status).toBe(400) // must tick the box
    expect((await signUp('ana@example.test')).status).toBe(202)
    expect(testOutbox).toHaveLength(1)
    expect(testOutbox[0]).toMatchObject({ to: 'ana@example.test', category: 'interest' })

    // Signing up again straight away doesn't send another email, and the answer is the same.
    expect((await signUp('Ana@Example.test')).status).toBe(202)
    expect(testOutbox).toHaveLength(1)

    const { agent, csrf } = await login(user.email)
    expect((await agent.get('/api/admin/orgs/alpha/interest')).body).toMatchObject({ people: [], pending: 1 })

    // Confirming puts them on the list.
    const confirmed = await request(app).post(`/api/public/interest/${tokenFrom(testOutbox[0].text, 'confirm')}/confirm`)
    expect(confirmed.body).toMatchObject({ orgSlug: 'alpha' })
    const list = await agent.get('/api/admin/orgs/alpha/interest')
    expect(list.body.people).toEqual([expect.objectContaining({ email: 'ana@example.test', name: 'Ana', from: retreat.title })])
    expect((await agent.get('/api/admin/orgs/alpha/interest.csv')).text).toContain('ana@example.test')

    // The organiser emails everyone; each email has a working unsubscribe link.
    testOutbox.length = 0
    const sent = await agent.post('/api/admin/orgs/alpha/interest/notify').set('X-CSRF-Token', csrf).send({ subject: 'Next retreat open', message: 'Our 2027 retreat is open for booking.' })
    expect(sent.body).toEqual({ sent: 1, failed: 0 })
    expect(testOutbox[0].text).toContain('Unsubscribe:')
    // Not twice in a row.
    expect((await agent.post('/api/admin/orgs/alpha/interest/notify').set('X-CSRF-Token', csrf).send({ subject: 'Again', message: 'Another message here.' })).status).toBe(429)

    // Unsubscribing deletes the address.
    const unsub = await request(app).post(`/api/public/interest/${tokenFrom(testOutbox[0].text, 'unsubscribe')}/unsubscribe`)
    expect(unsub.status).toBe(200)
    expect(await prisma.interestSignup.count()).toBe(0)
    expect((await request(app).post(`/api/public/interest/${tokenFrom(testOutbox[0].text, 'unsubscribe')}/unsubscribe`)).status).toBe(404)
  })

  it('deletes sign-ups never confirmed after 30 days', async () => {
    await makeTenant('alpha')
    await request(app).post('/api/public/orgs/alpha/interest').send({ email: 'old@example.test', consent: true })
    await prisma.interestSignup.updateMany({ data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } })
    const counts = await runRetention(new Date())
    expect(counts.interestUnconfirmed).toBe(1)
    expect(await prisma.interestSignup.count()).toBe(0)
  })
})
