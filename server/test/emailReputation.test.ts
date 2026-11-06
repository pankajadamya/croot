import { createSign, generateKeyPairSync } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '../src/lib/env.js'
import { suppressedSkips, testOutbox } from '../src/lib/mailer.js'
import { ensurePlatformAdmins } from '../src/lib/platformAdmins.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { applySesEvent, stringToSign, verifySns } from '../src/modules/sesWebhook.js'
import { app, invite, login, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

const TOPIC = 'arn:aws:sns:eu-west-1:123456789012:croot-ses-feedback'
const savedTopic = env.SES_FEEDBACK_TOPIC_ARN
afterEach(() => {
  env.SES_FEEDBACK_TOPIC_ARN = savedTopic
})

const bounce = (to: string, messageId: string, bounceType = 'Permanent') => ({
  eventType: 'Bounce',
  mail: { messageId },
  bounce: { bounceType, bouncedRecipients: [{ emailAddress: to, diagnosticCode: 'smtp; 550 5.1.1 user unknown' }] },
})

describe('SNS messages', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  function signed(fields: Record<string, string>, version = '2') {
    const msg: Record<string, string> = {
      Type: 'Notification',
      MessageId: 'm-1',
      TopicArn: TOPIC,
      Message: '{}',
      Timestamp: new Date().toISOString(),
      SignatureVersion: version,
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem',
      ...fields,
    }
    msg.Signature = createSign(version === '2' ? 'RSA-SHA256' : 'RSA-SHA1').update(stringToSign(msg)).sign(privateKey, 'base64')
    return msg
  }
  const cert = async () => pem

  it('accepts only messages signed by the certificate at an AWS SNS address, and recent', async () => {
    expect(await verifySns(signed({}), cert)).toBe(true)
    expect(await verifySns(signed({}, '1'), cert)).toBe(true)
    const tampered = { ...signed({}), Message: '{"eventType":"Complaint"}' }
    expect(await verifySns(tampered, cert)).toBe(false)
    expect(await verifySns(signed({ SigningCertURL: 'https://evil.example/SimpleNotificationService-abc.pem' }), cert)).toBe(false)
    expect(await verifySns(signed({ SigningCertURL: 'http://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem' }), cert)).toBe(false)
    expect(await verifySns(signed({ Timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }), cert)).toBe(false)
  })

  it('the webhook refuses other topics and unsigned messages, and is off without a topic', async () => {
    env.SES_FEEDBACK_TOPIC_ARN = ''
    expect((await request(app).post('/api/webhooks/ses').set('Content-Type', 'text/plain').send('{}')).status).toBe(404)
    env.SES_FEEDBACK_TOPIC_ARN = TOPIC
    const other = await request(app).post('/api/webhooks/ses').set('Content-Type', 'text/plain').send(JSON.stringify({ ...signed({}), TopicArn: 'arn:aws:sns:eu-west-1:1:other' }))
    expect(other.status).toBe(403)
    const unsigned = await request(app).post('/api/webhooks/ses').set('Content-Type', 'text/plain').send(JSON.stringify({ ...signed({}), Signature: 'AAAA' }))
    expect(unsigned.status).toBe(403)
  })
})

describe('bounces and complaints', () => {
  it('a permanent bounce stops all email to the address and tells the organiser; a corrected address works again', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { attendee } = await invite(org.id, retreat.id, 'Ana Guest', 'ana@example.test')
    const sent = await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/email-invite`).set('X-CSRF-Token', csrf)
    expect(sent.status).toBe(200)
    const messageId = (await prisma.emailSend.findFirstOrThrow({ where: { organisationId: org.id } })).messageId!

    // A full mailbox may recover: not suppressed. A permanent bounce is.
    expect((await applySesEvent(bounce('ana@example.test', messageId, 'Transient'))).applied).toBe(0)
    expect((await applySesEvent(bounce('Ana@Example.test', messageId))).applied).toBe(1)
    expect(await prisma.emailSuppression.findUnique({ where: { email: 'ana@example.test' } })).toMatchObject({ reason: 'bounced' })
    expect(await prisma.emailFeedback.findFirst()).toMatchObject({ organisationId: org.id, kind: 'bounced' })

    const again = await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/email-invite`).set('X-CSRF-Token', csrf)
    expect(again.status).toBe(409)
    expect(again.body.error ?? again.body.message).toContain('bounced')
    const list = (await agent.get(`/api/admin/orgs/alpha/retreats/${retreat.id}/attendees`)).body.attendees
    expect(list[0]).toMatchObject({ emailProblem: 'bounced' })
    const bell = (await agent.get('/api/attention')).body.items as Array<{ title: string }>
    expect(bell.map((i) => i.title)).toContain('Ana Guest’s email isn’t reaching them')

    // Any mail at all to the address is skipped, sign-in codes included.
    await request(app).post('/api/auth/code/request').send({ email: 'ana@example.test' })
    await new Promise((r) => setTimeout(r, 200)) // the code email is sent in the background
    expect(suppressedSkips).toContain('ana@example.test')

    const fixed = await agent.patch(`/api/admin/orgs/alpha/attendees/${attendee.id}`).set('X-CSRF-Token', csrf).send({ email: 'ana.guest@example.test' })
    expect(fixed.body.attendee).toMatchObject({ email: 'ana.guest@example.test', emailProblem: null })
    expect((await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/email-invite`).set('X-CSRF-Token', csrf)).status).toBe(200)
    expect((await agent.get('/api/attention')).body.items.map((i: { title: string }) => i.title)).not.toContain('Ana Guest’s email isn’t reaching them')
  })

  it('a spam complaint suppresses the address and alerts admins about that organisation', async () => {
    await ensurePlatformAdmins(['boss@example.test'])
    const { org, user, retreat } = await makeTenant('alpha')
    const { agent, csrf } = await login(user.email)
    const { attendee } = await invite(org.id, retreat.id, 'Ben', 'ben@example.test')
    await agent.post(`/api/admin/orgs/alpha/attendees/${attendee.id}/email-invite`).set('X-CSRF-Token', csrf)
    const messageId = (await prisma.emailSend.findFirstOrThrow()).messageId!
    await applySesEvent({ eventType: 'Complaint', mail: { messageId }, complaint: { complainedRecipients: [{ emailAddress: 'ben@example.test' }], complaintFeedbackType: 'abuse' } })
    expect(await prisma.emailSuppression.findUnique({ where: { email: 'ben@example.test' } })).toMatchObject({ reason: 'complained' })

    const boss = await prisma.user.findUniqueOrThrow({ where: { email: 'boss@example.test' } })
    await prisma.user.update({ where: { id: boss.id }, data: { passwordHash: user.passwordHash } })
    const admin = await login('boss@example.test')
    const items = (await admin.agent.get('/api/attention')).body.items as Array<{ title: string; detail: string }>
    expect(items.find((i) => i.title === 'alpha: email problems in the last day')?.detail).toContain('1 spam complaint')

    // Pausing the organisation's email stops its sends, and takes the alert away.
    expect((await admin.agent.post(`/api/platform/orgs/${org.id}/email`).set('X-CSRF-Token', admin.csrf).send({ paused: true })).status).toBe(200)
    const { attendee: other } = await invite(org.id, retreat.id, 'Cara', 'cara@example.test')
    const blocked = await agent.post(`/api/admin/orgs/alpha/attendees/${other.id}/email-invite`).set('X-CSRF-Token', csrf)
    expect(blocked.status).toBe(409)
    expect((await admin.agent.get('/api/attention')).body.items.map((i: { title: string }) => i.title)).not.toContain('alpha: email problems in the last day')
    const orgs = (await admin.agent.get('/api/platform/orgs')).body.orgs
    expect(orgs[0].email).toMatchObject({ paused: true, sentToday: 1, complaintsWeek: 1, limit: 200 })
  })
})

describe('daily limit', () => {
  it('stops a bulk send at the organisation’s limit and says how many wait', async () => {
    const { org, user, retreat } = await makeTenant('alpha')
    await prisma.organisation.update({ where: { id: org.id }, data: { dailyEmailLimit: 2 } })
    const { agent, csrf } = await login(user.email)
    for (const n of ['a', 'b', 'c']) await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: n, email: `${n}@example.test` } })
    const before = testOutbox.length
    const res = await agent.post(`/api/admin/orgs/alpha/retreats/${retreat.id}/invites/email-all`).set('X-CSRF-Token', csrf)
    expect(res.body).toMatchObject({ sent: 2, failed: [], notYet: 1 })
    expect(res.body.stopped).toContain('sent its 2 emails for today')
    expect(testOutbox.length - before).toBe(2)
  })
})
