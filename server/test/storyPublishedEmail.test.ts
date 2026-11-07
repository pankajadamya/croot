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

async function sendStory(token: string, storyText: string, revision = 0) {
  const draft = await request(app).put(`/api/invites/${token}/draft`).send({ revision, storyText, consents: { publicText: true } })
  expect(draft.status).toBe(200)
  expect((await request(app).post(`/api/invites/${token}/submit`).send({ revision: draft.body.revision })).status).toBe(200)
}
const published = () => testOutbox.filter((m) => /story about .* (is published|is live)/.test(m.subject))

describe('guests hear where their story is published', () => {
  it('emails the guest a link to their story (and the retreat page) when it first goes live, once', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    await prisma.retreat.update({ where: { id: retreat.id }, data: { status: 'collecting' } })
    const { token } = await invite(org.id, retreat.id, 'Maya Sample', 'maya@example.test')
    await sendStory(token, 'A lovely week. The teachers were kind.')
    const response = await prisma.response.findFirstOrThrow()
    const { agent, csrf } = await login(user.email)
    testOutbox.length = 0

    const ok = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect(ok.status).toBe(200)
    expect(ok.body.guestEmailed).toBe(true)
    const [mail, ...more] = published()
    expect(more).toHaveLength(0)
    expect(mail).toMatchObject({ to: 'maya@example.test', subject: `Your story about ${retreat.title} is published` })
    expect(mail.text).toContain('Hello Maya,')
    expect(mail.text).toContain(`/stories/${ok.body.publicSlug}`)
    expect(mail.text).toContain(`/o/alpha/r/${retreat.slug}`)
    expect(mail.text).toContain('withdraw it at any time')

    // Republishing the same words (the organiser changing photos or the excerpt): no second email.
    testOutbox.length = 0
    const again = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({ excerpt: 'A lovely week.' })
    expect(again.status).toBe(200)
    expect(published()).toHaveLength(0)
  })

  it('a guest with no email address is simply not emailed; the publish still works', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const attendee = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: 'Meera' } })
    const { issueInvitation } = await import('../src/lib/invites.js')
    const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: attendee.id, ttlDays: 30 })
    await sendStory(token, 'Wonderful food and kind teachers.')
    const response = await prisma.response.findFirstOrThrow()
    const { agent, csrf } = await login(user.email)
    testOutbox.length = 0
    const ok = await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({})
    expect(ok.status).toBe(200)
    expect(ok.body.guestEmailed).toBe(false)
    expect(published()).toHaveLength(0)
  })
})

describe('the review page shows which photos are in the album, separately from the story', () => {
  it('reports inAlbum, and taking a photo out of the album keeps it out whatever the story shows', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id, 'Maya', 'maya@example.test')
    await sendStory(token, 'A lovely week.')
    const response = await prisma.response.findFirstOrThrow()
    const base = { organisationId: org.id, retreatId: retreat.id, responseId: response.id, kind: 'guest' as const, mime: 'image/webp', sizeBytes: 10, width: 10, height: 10, derivativeKey: 'x/web.webp', moderation: 'approved' as const, publishConsent: true }
    const shared = await prisma.mediaAsset.create({ data: { ...base, albumConsent: true } })
    const storyOnly = await prisma.mediaAsset.create({ data: { ...base, albumConsent: false } })
    const { agent, csrf } = await login(user.email)

    const detail = async () => (await agent.get(`/api/admin/orgs/alpha/responses/${response.id}`)).body.photos as Array<{ id: string; inAlbum: boolean }>
    expect((await detail()).find((p) => p.id === shared.id)?.inAlbum).toBe(true)
    expect((await detail()).find((p) => p.id === storyOnly.id)?.inAlbum).toBe(false)

    // Published with neither photo ticked: the shared one is still in the album until taken out.
    expect((await agent.post(`/api/admin/orgs/alpha/responses/${response.id}/publish`).set('X-CSRF-Token', csrf).send({ photoIds: [] })).status).toBe(200)
    const album = async () => ((await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/album`)).body.media as Array<{ id: string; inAlbum: boolean }>).filter((m) => m.inAlbum).map((m) => m.id)
    expect(await album()).toContain(shared.id)

    expect((await agent.patch(`/api/admin/orgs/alpha/media/${shared.id}`).set('X-CSRF-Token', csrf).send({ inAlbum: false })).status).toBe(200)
    expect((await detail()).find((p) => p.id === shared.id)?.inAlbum).toBe(false)
    expect(await album()).not.toContain(shared.id)
  })
})
