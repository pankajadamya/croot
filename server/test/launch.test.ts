import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runRetention } from '../src/jobs/retention.js'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { storage } from '../src/lib/storage.js'
import { removeObjects } from '../src/lib/storageCleanup.js'
import { stripVideoMetadata } from '../src/lib/video.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
  testOutbox.length = 0
})
afterAll(closeDatabase)

async function signInByCode(email: string) {
  const agent = request.agent(app)
  await agent.post('/api/auth/code/request').send({ email })
  const code = /(\d{6})/.exec(testOutbox.at(-1)?.text ?? '')?.[1]
  const res = await agent.post('/api/auth/code/verify').send({ email, code })
  return { agent, csrf: res.body.csrfToken as string }
}

describe('invitation email', () => {
  it('names who is asking, links the privacy notice and says how to opt out', async () => {
    const { org, retreat } = await makeTenant('alpha')
    await prisma.organisation.update({ where: { id: org.id }, data: { legalName: 'Alpha Retreats Ltd', legalAddress: '1 Example Road, Testtown' } })
    const { attendee } = await invite(org.id, retreat.id)
    const owner = await login('alpha@owner.test')
    const res = await owner.agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/email-invite`).set('X-CSRF-Token', owner.csrf)
    expect(res.status).toBe(200)
    const mail = testOutbox.at(-1)!
    expect(mail.text).toContain('on behalf of Alpha Retreats Ltd, 1 Example Road, Testtown')
    expect(mail.text).toContain('/o/alpha/privacy')
    expect(mail.text).toContain('your details are deleted after 180 days')
    expect(mail.html).toContain('How your information is used')
  })
})

describe('announcement emails', () => {
  it('carry the same unsubscribe link every time, plus one-click unsubscribe headers', async () => {
    const { org } = await makeTenant('alpha')
    const signup = await prisma.interestSignup.create({
      data: { organisationId: org.id, email: 'fan@example.test', name: 'Fan', consentWording: 'x', tokenHash: 'h'.repeat(64), confirmedAt: new Date() },
    })
    const owner = await login('alpha@owner.test')
    const send = () => owner.agent.post('/api/admin/orgs/alpha/interest/notify').set('X-CSRF-Token', owner.csrf).send({ subject: 'News', message: 'Our next retreat is open.' })
    expect((await send()).body).toMatchObject({ sent: 1, failed: 0 })
    const first = testOutbox.at(-1)!
    await prisma.auditEvent.deleteMany() // skip the "not twice in a row" pause
    await send()
    const second = testOutbox.at(-1)!
    const link = (t: string) => /\/interest\/([\w.-]+)\/unsubscribe/.exec(t)![1]
    expect(link(first.text)).toBe(link(second.text))
    expect(second.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(second.headers?.['List-Unsubscribe']).toContain(`/api/public/interest/${link(second.text)}/unsubscribe`)

    // The link from the first email still works, and a tampered one doesn't.
    const tampered = link(first.text).slice(0, -2) + 'xx'
    expect((await request(app).post(`/api/public/interest/${tampered}/unsubscribe`)).status).toBe(404)
    expect((await request(app).post(`/api/public/interest/${link(first.text)}/unsubscribe`)).status).toBe(200)
    expect(await prisma.interestSignup.findUnique({ where: { id: signup.id } })).toBeNull()
  })
})

describe('delete my account', () => {
  it('deletes the account and signs out; reviews stay with the organiser', async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, keepText: 'Lovely' })
    await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })

    const guest = await signInByCode('guest@example.test')
    const wrong = await guest.agent.delete('/api/account').set('X-CSRF-Token', guest.csrf).send({ confirmEmail: 'someone@else.test' })
    expect(wrong.status).toBe(400)
    const res = await guest.agent.delete('/api/account').set('X-CSRF-Token', guest.csrf).send({ confirmEmail: 'Guest@Example.test' })
    expect(res.status).toBe(200)
    expect(await prisma.user.findUnique({ where: { email: 'guest@example.test' } })).toBeNull()
    expect(await prisma.session.count({ where: { user: { email: 'guest@example.test' } } })).toBe(0)
    expect((await guest.agent.get('/api/auth/me')).status).toBe(401)
    expect(await prisma.response.count()).toBe(1) // the organiser's record of the review stays
  })

  it("won't leave an organisation without an owner, and won't delete an admin", async () => {
    await makeTenant('alpha')
    const owner = await signInByCode('alpha@owner.test')
    const res = await owner.agent.delete('/api/account').set('X-CSRF-Token', owner.csrf).send({ confirmEmail: 'alpha@owner.test' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('only owner')

    await prisma.user.create({ data: { email: 'boss@example.test', name: 'Boss', isPlatformAdmin: true } })
    const admin = await signInByCode('boss@example.test')
    expect((await admin.agent.delete('/api/account').set('X-CSRF-Token', admin.csrf).send({ confirmEmail: 'boss@example.test' })).status).toBe(409)
  })
})

describe('video location data', () => {
  const box = (type: string, payload: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(8 + payload.length, 0)
    head.write(type, 4, 'latin1')
    return Buffer.concat([head, payload])
  }

  it('clears udta/meta boxes (phone GPS) in place, leaving sizes and the picture data untouched', async () => {
    const gps = Buffer.from('©xyz+50.7192-001.8808/', 'latin1')
    const mdatPayload = Buffer.from('PICTURE-AND-SOUND-BYTES')
    const file = Buffer.concat([
      box('ftyp', Buffer.from('isom\0\0\0\0isomiso2', 'latin1')),
      box('moov', Buffer.concat([box('mvhd', Buffer.alloc(20)), box('udta', gps), box('meta', Buffer.from('com.apple.quicktime.location.ISO6709 +50.7')), box('trak', box('udta', gps))])),
      box('mdat', mdatPayload),
    ])
    const dir = await mkdtemp(join(tmpdir(), 'croot-video-'))
    const path = join(dir, 'clip.mp4')
    await writeFile(path, file)
    try {
      expect(await stripVideoMetadata(path)).toBe(3)
      const out = await readFile(path)
      expect(out.length).toBe(file.length)
      expect(out.includes(Buffer.from('+50.7'))).toBe(false)
      expect(out.includes(Buffer.from('udta'))).toBe(false)
      expect(out.includes(mdatPayload)).toBe(true)
      expect(out.subarray(0, 4).equals(file.subarray(0, 4))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('failed file deletions', () => {
  it('are queued and retried by the retention job, never silently dropped', async () => {
    const spy = vi.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('storage unavailable'))
    await removeObjects(['org/x/retreat/y/guest/z/original', 'org/x/retreat/y/guest/z/web.webp'])
    expect(await prisma.pendingStorageDeletion.findMany()).toEqual([expect.objectContaining({ key: 'org/x/retreat/y/guest/z/original', attempts: 1 })])

    const counts = await runRetention()
    expect(counts).toMatchObject({ storageRetried: 1, storageStillFailing: 0 })
    expect(await prisma.pendingStorageDeletion.count()).toBe(0)
    spy.mockRestore()
  })
})

describe('team emails', () => {
  it('emails a new team member a sign-in link instead of handing the owner a password link', async () => {
    await makeTenant('alpha')
    const owner = await login('alpha@owner.test')
    const res = await owner.agent
      .post('/api/admin/orgs/alpha/members')
      .set('X-CSRF-Token', owner.csrf)
      .send({ email: 'Nia.New@example.test', name: 'Nia New', role: 'organiser' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ setupUrl: null, emailed: true })
    const mail = testOutbox.at(-1)!
    expect(mail.to).toBe('nia.new@example.test')
    expect(mail.subject).toBe('You’ve been added to alpha on Croot')
    expect(mail.text).toContain('alpha owner added you to alpha on Croot as an organiser')
    expect(mail.text).toContain('/signin?next=%2Fadmin%2Falpha')
  })

  it('emails the owner of an organisation an admin creates', async () => {
    await prisma.user.create({ data: { email: 'boss@example.test', name: 'Boss', isPlatformAdmin: true } })
    const admin = await signInByCode('boss@example.test')
    const res = await admin.agent
      .post('/api/platform/orgs')
      .set('X-CSRF-Token', admin.csrf)
      .send({ name: 'Lakeside Wellness', ownerEmail: 'lee@example.test', ownerName: 'Lee' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ setupUrl: null, emailed: true })
    expect(testOutbox.at(-1)).toMatchObject({ to: 'lee@example.test', subject: 'You’ve been added to Lakeside Wellness on Croot' })
    expect(testOutbox.at(-1)!.text).toContain('The Croot team added you to Lakeside Wellness on Croot as an owner')
  })
})
