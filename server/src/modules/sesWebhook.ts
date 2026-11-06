import { createVerify, X509Certificate } from 'node:crypto'
import express, { Router } from 'express'
import { normaliseEmail } from '../lib/emailGuard.js'
import { env } from '../lib/env.js'
import { HttpError, route } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'

/**
 * Bounces and complaints from Amazon SES, delivered by SNS (the configuration set's event
 * destination). Every message is checked before it is believed:
 *  - it must come from the one configured topic (SES_FEEDBACK_TOPIC_ARN);
 *  - its signature must verify against an AWS SNS signing certificate fetched over HTTPS from an
 *    sns.<region>.amazonaws.com host (never a URL taken on trust).
 * A permanent bounce or a complaint puts the address on the suppression list: Croot never mails it
 * again, the organiser sees it against the guest, and admins see spikes per organisation.
 */
export const sesWebhookRouter = Router()

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/

export function isSnsUrl(value: unknown, path?: RegExp): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname) && (!path || path.test(url.pathname))
  } catch {
    return false
  }
}

/** The text SNS signs: chosen keys, in order, each as "Key\nValue\n". */
export function stringToSign(msg: Record<string, string>): string {
  const keys =
    msg.Type === 'Notification'
      ? ['Message', 'MessageId', ...(msg.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return keys.map((k) => `${k}\n${msg[k] ?? ''}\n`).join('')
}

const certs = new Map<string, string>()
export async function fetchCert(url: string): Promise<string> {
  const cached = certs.get(url)
  if (cached) return cached
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`signing certificate: ${res.status}`)
  const pem = await res.text()
  // Must be a real certificate issued for an SNS host.
  const cert = new X509Certificate(pem)
  if (!/sns\.amazonaws\.com/.test(cert.subject) && !cert.checkHost('sns.amazonaws.com')) throw new Error('not an SNS signing certificate')
  if (new Date(cert.validTo) < new Date()) throw new Error('signing certificate expired')
  certs.set(url, pem)
  return pem
}

export async function verifySns(msg: Record<string, string>, getCert = fetchCert): Promise<boolean> {
  if (!isSnsUrl(msg.SigningCertURL, /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/)) return false
  if (typeof msg.Signature !== 'string' || !['1', '2'].includes(msg.SignatureVersion)) return false
  // Replays: SNS messages carry their time; anything over an hour old is refused.
  const age = Date.now() - Date.parse(msg.Timestamp)
  if (!Number.isFinite(age) || age > 3600_000 || age < -300_000) return false
  const pem = await getCert(msg.SigningCertURL)
  return createVerify(msg.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
    .update(stringToSign(msg), 'utf8')
    .verify(pem, msg.Signature, 'base64')
}

type SesEvent = {
  eventType?: string
  notificationType?: string
  mail?: { messageId?: string }
  bounce?: { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }> }
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }>; complaintFeedbackType?: string }
}

/** Applies one SES event: suppress the addresses, and count it against the organisation that sent it. */
export async function applySesEvent(event: SesEvent) {
  const kind = event.eventType ?? event.notificationType
  let reason: 'bounced' | 'complained'
  let recipients: Array<{ address: string; detail: string }>
  if (kind === 'Bounce') {
    // Only permanent bounces mean the address is gone; a full mailbox (transient) may recover.
    if (event.bounce?.bounceType !== 'Permanent') return { applied: 0 }
    reason = 'bounced'
    recipients = (event.bounce.bouncedRecipients ?? []).map((r) => ({ address: r.emailAddress ?? '', detail: (r.diagnosticCode ?? '').slice(0, 300) }))
  } else if (kind === 'Complaint') {
    reason = 'complained'
    recipients = (event.complaint?.complainedRecipients ?? []).map((r) => ({ address: r.emailAddress ?? '', detail: event.complaint?.complaintFeedbackType ?? '' }))
  } else {
    return { applied: 0 }
  }
  const sent = event.mail?.messageId ? await prisma.emailSend.findUnique({ where: { messageId: event.mail.messageId }, select: { organisationId: true } }) : null
  let applied = 0
  for (const r of recipients) {
    const email = normaliseEmail(r.address)
    if (!email.includes('@') || email.length > 320) continue
    await prisma.emailSuppression.upsert({
      where: { email },
      // A complaint outranks a bounce for the same address.
      update: reason === 'complained' ? { reason, detail: r.detail } : {},
      create: { email, reason, detail: r.detail },
    })
    await prisma.emailFeedback.create({ data: { organisationId: sent?.organisationId ?? null, kind: reason } })
    applied++
  }
  return { applied }
}

sesWebhookRouter.post(
  '/ses',
  // SNS posts JSON as text/plain.
  express.text({ type: '*/*', limit: '256kb' }),
  route(async (req, res) => {
    if (!env.SES_FEEDBACK_TOPIC_ARN) throw new HttpError(404, 'Not found')
    let msg: Record<string, string>
    try {
      msg = JSON.parse(typeof req.body === 'string' ? req.body : '')
    } catch {
      throw new HttpError(400, 'Not an SNS message')
    }
    if (msg.TopicArn !== env.SES_FEEDBACK_TOPIC_ARN) throw new HttpError(403, 'Unknown topic')
    if (!(await verifySns(msg).catch(() => false))) throw new HttpError(403, 'Signature did not verify')

    if (msg.Type === 'SubscriptionConfirmation') {
      // Confirming means fetching the SubscribeURL, which must itself be an SNS address.
      if (!isSnsUrl(msg.SubscribeURL)) throw new HttpError(400, 'Unexpected subscribe URL')
      const confirm = await fetch(msg.SubscribeURL, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      console.log(`SES feedback subscription confirmed: ${confirm.status}`)
      return res.json({ ok: true })
    }
    if (msg.Type !== 'Notification') return res.json({ ok: true })
    let event: SesEvent
    try {
      event = JSON.parse(msg.Message)
    } catch {
      throw new HttpError(400, 'Message is not JSON')
    }
    const { applied } = await applySesEvent(event)
    res.json({ ok: true, applied })
  }),
)
