import { randomBytes } from 'node:crypto'
import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { backfillThumbs } from '../src/jobs/retention.js'
import { redactPath } from '../src/lib/logger.js'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { storage } from '../src/lib/storage.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(() => {
  testOutbox.length = 0
  return resetDatabase()
})
afterAll(closeDatabase)

describe('hardening before launch', () => {
  it('mail strangers can cause doesn’t use up the organisation’s invitations', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    await prisma.organisation.update({ where: { id: org.id }, data: { dailyEmailLimit: 1 } })
    // Someone fills in the interest form twice (public mail, its own budget)…
    for (const e of ['x1@example.test', 'x2@example.test']) await request(app).post('/api/public/orgs/alpha/interest').send({ email: e, name: 'X', consent: true })
    expect(await prisma.emailSend.count({ where: { trigger: 'public' } })).toBeGreaterThan(0)
    // …and the organisation can still send today's one invitation.
    const { agent, csrf } = await login(user.email)
    const a = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: 'Asha', email: 'asha@example.test' } })
    expect((await agent.post(`/api/admin/orgs/alpha/attendees/${a.id}/email-invite`).set('X-CSRF-Token', csrf)).status).toBe(200)
  })

  it('email invitations go a few at a time and stop at the daily limit', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    await prisma.organisation.update({ where: { id: org.id }, data: { dailyEmailLimit: 6 } })
    for (let i = 0; i < 9; i++) await invite(org.id, retreat.id, `G${i}`, `g${i}@example.test`)
    const { agent, csrf } = await login(user.email)
    const r = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/invites/email-all`).set('X-CSRF-Token', csrf)
    expect(r.body).toMatchObject({ sent: 6, notYet: 3 })
    expect(r.body.stopped).toMatch(/emails for today/)
    expect(testOutbox.filter((m) => m.category === 'invitation')).toHaveLength(6)
  })

  it('keeps group-link and verification links out of the logs', () => {
    expect(redactPath('/api/group/AbCdEf123/join')).toBe('/api/group/[redacted]/join')
    expect(redactPath('/join/AbCdEf123')).toBe('/join/[redacted]')
    expect(redactPath('/api/verify/AbCdEf123')).toBe('/api/verify/[redacted]')
  })

  it('stores a small copy of each photo for grids, and makes one for older photos', async () => {
    const { user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const big = await sharp(randomBytes(3000 * 2000 * 3), { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg().toBuffer()
    const up = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/media?album=1`).set('X-CSRF-Token', csrf).field('rightsConfirmed', 'true').attach('image', big, 'big.jpg')
    expect(up.status).toBe(201)
    const m = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.body.media.id } })
    expect(m.thumbKey).toBeTruthy()
    const full = await agent.get(`/api/admin/orgs/alpha/media/${m.id}/preview`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    const small = await agent.get(`/api/admin/orgs/alpha/media/${m.id}/preview?size=thumb`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    expect((await sharp(small.body as Buffer).metadata()).width).toBe(640)
    expect((small.body as Buffer).length).toBeLessThan((full.body as Buffer).length / 3)

    // An older photo without one gets it from the background job.
    await prisma.mediaAsset.update({ where: { id: m.id }, data: { thumbKey: null } })
    expect(await backfillThumbs(10)).toBe(1)
    const after = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: m.id } })
    expect(after.thumbKey).toMatch(/-thumb\.webp$/)
    expect(await storage.size(after.thumbKey!)).toBeGreaterThan(0)
  })
})
