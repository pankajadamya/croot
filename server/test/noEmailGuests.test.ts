import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { testOutbox as outbox } from '../src/lib/mailer.js'
import { app, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

describe('guests without an email address', () => {
  it('can be added and imported, get a link to share, and are skipped by email sends', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const api = `/api/admin/orgs/alpha/retreats/${retreat.id}`

    // One at a time: email left out, or blank.
    expect((await agent.post(`${api}/attendees`).set('X-CSRF-Token', csrf).send({ name: 'Ravi Kumar' })).status).toBe(201)
    expect((await agent.post(`${api}/attendees`).set('X-CSRF-Token', csrf).send({ name: 'Ravi Kumar', email: '' })).status).toBe(201) // same name allowed
    expect((await agent.post(`${api}/attendees`).set('X-CSRF-Token', csrf).send({ name: 'Bad', email: 'not-an-email' })).status).toBe(400)

    // From a list: blank emails are fine; a name-only header is recognised.
    const preview = await agent.post(`${api}/attendees/preview`).set('X-CSRF-Token', csrf).send({ csv: 'name,email\nAsha Patel,asha@example.com\nMeera,\n' })
    expect(preview.body.rows.map((r: { name: string; email: string; status: string }) => [r.name, r.email, r.status])).toEqual([
      ['Asha Patel', 'asha@example.com', 'ok'],
      ['Meera', '', 'ok'],
    ])
    const nameOnly = await agent.post(`${api}/attendees/preview`).set('X-CSRF-Token', csrf).send({ csv: 'name\nJo\n' })
    expect(nameOnly.body.rows).toMatchObject([{ name: 'Jo', email: '', status: 'ok' }])
    const imported = await agent.post(`${api}/attendees/import`).set('X-CSRF-Token', csrf).send({ rows: [{ name: 'Asha Patel', email: 'Asha@Example.com' }, { name: 'Meera', email: '' }] })
    expect(imported.body).toEqual({ imported: 2, skipped: 0 })

    const list = (await agent.get(`${api}/attendees`)).body.attendees as Array<{ id: string; name: string; email: string | null; emailProblem: string | null }>
    expect(list.map((a) => [a.name, a.email])).toEqual([
      ['Asha Patel', 'asha@example.com'],
      ['Meera', null],
      ['Ravi Kumar', null],
      ['Ravi Kumar', null],
    ])
    const meera = list.find((a) => a.name === 'Meera')!

    // Their link works as usual…
    const link = await agent.post(`/api/admin/orgs/alpha/attendees/${meera.id}/invite`).set('X-CSRF-Token', csrf)
    expect(link.body.url).toMatch(/\/invite\/[\w-]+\?via=link$/)
    const token = new URL(link.body.url).pathname.split('/').pop()!
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(200)

    // …but Croot can't email them, and "email everyone" leaves them out.
    const one = await agent.post(`/api/admin/orgs/alpha/attendees/${meera.id}/email-invite`).set('X-CSRF-Token', csrf)
    expect(one.status).toBe(400)
    expect(one.body.error).toMatch(/no email address for Meera/)
    outbox.length = 0
    const all = await agent.post(`${api}/invites/email-all`).set('X-CSRF-Token', csrf)
    expect(all.body).toMatchObject({ sent: 1, failed: [] })
    expect(outbox.map((m) => m.to)).toEqual(['asha@example.com'])

    // An email can be added later.
    const added = await agent.patch(`/api/admin/orgs/alpha/attendees/${meera.id}`).set('X-CSRF-Token', csrf).send({ email: 'meera@example.com' })
    expect(added.body.attendee.email).toBe('meera@example.com')
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: meera.id } })).email).toBe('meera@example.com')
  })
})
