import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FEEDBACK_CATEGORIES } from '../../shared/categories.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

describe('private feedback categories changed after guests answered', () => {
  it('remembers a removed category, labels it in the guest’s data export, and never reuses its key', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { token } = await invite(org.id, retreat.id, 'Anika Example')
    const draft = await request(app)
      .put(`/api/invites/${token}/draft`)
      .send({ revision: 0, storyText: 'A calm week.', consents: { publicText: true }, ratings: [{ categoryKey: 'yoga', score: 5, notApplicable: false, comment: 'Lovely' }] })
    const receipt = (await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })).body.receiptToken

    const without = DEFAULT_FEEDBACK_CATEGORIES.filter((c) => c.key !== 'yoga')
    const save = (feedbackCategories: unknown) => agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ feedbackCategories })
    expect((await save(without)).status).toBe(200)

    const stored = await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })
    expect(stored.removedFeedbackCategories).toMatchObject([{ key: 'yoga', label: 'Yoga instruction and pace' }])
    // The rating is kept (hidden), and the guest's export still says what it was about.
    expect(await prisma.feedbackRating.count({ where: { categoryKey: 'yoga' } })).toBe(1)
    const exported = JSON.parse((await request(app).get(`/api/responses/${receipt}/export`)).text)
    expect(JSON.stringify(exported)).toContain('Yoga instruction and pace (no longer asked)')

    // Adding a category under the removed key is refused, so old ratings can't reappear under it.
    const reuse = await save([...without, { key: 'yoga', label: 'Yoga' }])
    expect(reuse.status).toBe(409)
    // A fresh key is fine; removing a category twice keeps one record of it.
    expect((await save([...without, { key: 'yoga-2', label: 'Yoga' }])).status).toBe(200)
    expect((await save(without)).status).toBe(200)
    const after = await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })
    expect((after.removedFeedbackCategories as Array<{ key: string }>).map((c) => c.key).sort()).toEqual(['yoga', 'yoga-2'])
  })

  it('renaming keeps the key, so nothing is recorded as removed', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const renamed = DEFAULT_FEEDBACK_CATEGORIES.map((c) => (c.key === 'yoga' ? { ...c, label: 'Yoga teaching' } : c))
    expect((await agent.patch(`/api/admin/orgs/alpha/retreats/${retreat.id}`).set('X-CSRF-Token', csrf).send({ feedbackCategories: renamed })).status).toBe(200)
    expect((await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id } })).removedFeedbackCategories).toEqual([])
  })
})
