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

async function send(token: string, extra: object = {}) {
  const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, storyText: 'A lovely week together.', consents: { publicText: true }, ...extra })
  expect(draft.status).toBe(200)
  expect((await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })).status).toBe(200)
}

describe('who guests went with', () => {
  it('defaults to on my own; a couple shows "Travelled as a couple" publicly, never who with, and stays one vote', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Asha', 'asha@example.test')
    const fresh = await request(app).get(`/api/invites/${token}`)
    expect(fresh.status).toBe(200)

    await send(token, { travelledWith: 'partner', partySize: 7 }) // a couple is two, whatever was sent
    const r = await prisma.response.findFirstOrThrow()
    expect(r).toMatchObject({ travelledWith: 'partner', partySize: 2 })

    const { agent, csrf } = await login(user.email)
    await agent.post(`/api/admin/orgs/alpha/responses/${r.id}/publish`).set('X-CSRF-Token', csrf).send({})
    const page = await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)
    expect(page.body.stories[0].company).toBe('Travelled as a couple')
    expect(JSON.stringify(page.body)).not.toMatch(/partner/i)
    expect((await request(app).get(`/api/public/stories/${page.body.stories[0].slug}`)).body.story.company).toBe('Travelled as a couple')
    expect((await agent.get(`/api/admin/orgs/alpha/responses/${r.id}`)).body.publicStory.company).toBe('Travelled as a couple')
  })

  it('on my own (the default) shows no label; a group shows its size', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { token: solo } = await invite(org.id, retreat.id, 'Asha', 'asha@example.test')
    const { token: fam } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await send(solo)
    await send(fam, { travelledWith: 'family', partySize: 4 })
    const { agent, csrf } = await login(user.email)
    for (const r of await prisma.response.findMany()) await agent.post(`/api/admin/orgs/alpha/responses/${r.id}/publish`).set('X-CSRF-Token', csrf).send({})
    const labels = (await request(app).get(`/api/public/orgs/alpha/retreats/${retreat.slug}`)).body.stories.map((s: { company: string | null }) => s.company).sort()
    expect(labels).toEqual([null, 'Travelled with family · group of 4'].sort())
  })
})

describe('parties', () => {
  it('groups guests who came together: one review counts the party, and bulk email stops chasing the other', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { attendee: asha, token: ashaToken } = await invite(org.id, retreat.id, 'Asha', 'asha@example.test')
    const { attendee: ravi } = await invite(org.id, retreat.id, 'Ravi', 'ravi@example.test')
    await invite(org.id, retreat.id, 'Meera', 'meera@example.test')
    const api = `/api/admin/orgs/alpha/retreats/${retreat.id}`

    expect((await agent.post(`${api}/parties`).set('X-CSRF-Token', csrf).send({ attendeeIds: [asha.id] })).status).toBe(400)
    const grouped = await agent.post(`${api}/parties`).set('X-CSRF-Token', csrf).send({ attendeeIds: [asha.id, ravi.id] })
    expect(grouped.status).toBe(200)
    const list = (await agent.get(`${api}/attendees`)).body.attendees as Array<{ name: string; partyId: string | null }>
    expect(list.filter((a) => a.partyId === grouped.body.partyId).map((a) => a.name).sort()).toEqual(['Asha', 'Ravi'])

    // Asha reviews: the party has responded; Ravi isn't emailed, Meera is.
    await send(ashaToken)
    const stats = (await agent.get('/api/admin/orgs/alpha')).body.retreats[0].stats
    expect(stats).toMatchObject({ attendees: 3, parties: 2, partiesResponded: 1 })
    testOutbox.length = 0
    await agent.post(`${api}/invites/email-all`).set('X-CSRF-Token', csrf)
    expect(testOutbox.map((m) => m.to)).toEqual(['meera@example.test'])

    // Ungrouping one of a pair leaves no party.
    expect((await agent.delete(`/api/admin/orgs/alpha/attendees/${ravi.id}/party`).set('X-CSRF-Token', csrf)).status).toBe(204)
    expect(await prisma.attendee.count({ where: { partyId: { not: null } } })).toBe(0)
  })

  it('grouping someone already in a party merges the parties', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const ids = await Promise.all(['A', 'B', 'C'].map(async (n) => (await invite(org.id, retreat.id, n, `${n.toLowerCase()}@example.test`)).attendee.id))
    const api = `/api/admin/orgs/alpha/retreats/${retreat.id}/parties`
    const first = await agent.post(api).set('X-CSRF-Token', csrf).send({ attendeeIds: [ids[0], ids[1]] })
    await agent.post(api).set('X-CSRF-Token', csrf).send({ attendeeIds: [ids[1], ids[2]] })
    expect(new Set((await prisma.attendee.findMany()).map((a) => a.partyId))).toEqual(new Set([first.body.partyId]))
  })
})
