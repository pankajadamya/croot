import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PROCESSING_TERMS_VERSION } from '../../shared/legal.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

type Item = { id: string; title: string; href: string; urgent?: boolean; scope: string }
const titles = (items: Item[]) => items.map((i) => i.title)

async function sendReview(token: string, body: Record<string, unknown>) {
  const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, ...body })
  const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })
  expect(sent.status).toBe(200)
  return sent.body.receiptToken as string
}

describe('notifications bell', () => {
  it('lists what needs the organiser, and each item clears once dealt with', async () => {
    const { org, retreat } = await makeTenant('alpha')
    await prisma.organisation.update({ where: { id: org.id }, data: { legalName: 'Alpha Ltd', legalAddress: '1 Road', privacyEmail: 'privacy@alpha.test', dpaVersion: PROCESSING_TERMS_VERSION } })
    const owner = await login('alpha@owner.test')
    const bell = async () => (await owner.agent.get('/api/attention')).body.items as Item[]
    expect(await bell()).toEqual([])

    // A guest's story, ready to publish, and a message asking for a change.
    const { token } = await invite(org.id, retreat.id, 'Ivy Guest', 'ivy@example.test')
    const receipt = await sendReview(token, { storyText: 'A lovely week.', consents: { publicText: true } })
    await request(app).post(`/api/responses/${receipt}/change-request`).send({ kind: 'edit', message: 'Please fix a typo in my story' })
    let items = await bell()
    expect(titles(items)).toContain('1 story ready to publish')
    const message = items.find((i) => i.id.startsWith('request:'))
    expect(message).toMatchObject({ title: 'Ivy Guest asked to change their review', urgent: true })
    expect(message?.href).toMatch(/^\/admin\/alpha\/responses\//)

    // Resolving the request and publishing the story clear both.
    const response = await prisma.response.findFirstOrThrow()
    const cr = await prisma.changeRequest.findFirstOrThrow()
    await owner.agent.post(`/api/admin/orgs/alpha/change-requests/${cr.id}/resolve`).set('X-CSRF-Token', owner.csrf).send({})
    await owner.agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', owner.csrf).send({})
    expect(await bell()).toEqual([])

    // Anonymous notes: shown once three have arrived, cleared when opened.
    for (const m of ['First note here', 'Second note here', 'Third note here']) await request(app).post(`/api/public/notes/${retreat.id}`).send({ message: m })
    items = await bell()
    expect(titles(items)).toEqual(['3 new anonymous notes'])
    await owner.agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/anonymous`)
    expect(await bell()).toEqual([])
  })

  it('reminds an organisation to add its privacy details, and shows admins pending requests', async () => {
    await makeTenant('alpha')
    const owner = await login('alpha@owner.test')
    expect(titles((await owner.agent.get('/api/attention')).body.items)).toEqual(['Add your privacy details'])

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'alpha@owner.test' } })
    await prisma.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: true } })
    await prisma.tenantRequest.create({ data: { orgName: 'New Org', contactName: 'Nia', email: 'nia@example.test', status: 'pending', source: 'request' } })
    const items = (await owner.agent.get('/api/attention')).body.items as Item[]
    expect(items[0]).toMatchObject({ scope: 'Admin', title: '1 organiser request to review', href: '/platform#pf-requests' })
  })

  it('needs a signed-in person', async () => {
    expect((await request(app).get('/api/attention')).status).toBe(401)
  })
})
