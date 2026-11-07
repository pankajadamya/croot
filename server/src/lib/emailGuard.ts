import { env } from './env.js'
import { HttpError } from './http.js'
import { sendMail, type Mail } from './mailer.js'
import { prisma } from './prisma.js'

/**
 * Protects croot.cx's sending reputation, which every organisation shares:
 *  - an address that bounced for good, or whose owner marked us as spam, is never mailed again
 *    (EmailSuppression, filled from SES feedback by modules/sesWebhook.ts; sendMail skips them);
 *  - guest-facing email (invitations, announcements, interest confirmations) counts against the
 *    organisation's daily limit, and an admin can pause an organisation's email altogether.
 * Sign-in codes and mail to organisers are not limited, only suppressed.
 */

export const normaliseEmail = (email: string) => email.trim().toLowerCase()

export async function suppressionOf(email: string) {
  return prisma.emailSuppression.findUnique({ where: { email: normaliseEmail(email) } })
}

/** Suppression status for many addresses at once (lower-cased address → reason). */
export async function suppressedAmong(emails: string[]) {
  const rows = await prisma.emailSuppression.findMany({ where: { email: { in: [...new Set(emails.map(normaliseEmail))] } } })
  return new Map(rows.map((r) => [r.email, r.reason]))
}

export const describeProblem = (reason: 'bounced' | 'complained') =>
  reason === 'bounced' ? 'bounced: the address doesn’t accept email' : 'was reported as spam by its owner'

/**
 * Mail someone else can cause (the interest form, group-link email codes) has its own small daily
 * budget, so strangers can never use up the organisation's invitations, and a burst of it stays small.
 */
export const PUBLIC_DAILY_LIMIT = 40

export async function dailyLimitOf(organisationId: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { dailyEmailLimit: true, emailPaused: true } })
  const sentToday = await prisma.emailSend.count({ where: { organisationId, trigger: 'organiser', sentAt: { gt: new Date(Date.now() - 24 * 3600_000) } } })
  const limit = org.dailyEmailLimit ?? env.ORG_DAILY_EMAIL_LIMIT
  return { limit, sentToday, left: Math.max(0, limit - sentToday), paused: org.emailPaused }
}

/**
 * Sends one guest-facing email for an organisation, or refuses with a reason the organiser can act on.
 * Throws HttpError: 409 paused or address suppressed, 429 over the daily limit.
 */
export async function sendOrgMail(organisationId: string, mail: Mail, opts: { trigger?: 'organiser' | 'public' } = {}) {
  const trigger = opts.trigger ?? 'organiser'
  if (trigger === 'public') {
    const publicToday = await prisma.emailSend.count({ where: { organisationId, trigger: 'public', sentAt: { gt: new Date(Date.now() - 24 * 3600_000) } } })
    if (publicToday >= PUBLIC_DAILY_LIMIT) throw new HttpError(429, 'We can’t send more emails like this today. Please try again tomorrow.')
  }
  const { limit, left: orgLeft, paused } = await dailyLimitOf(organisationId)
  // Public mail has its own budget (above), so it never uses up the organisation's.
  const left = trigger === 'public' ? Infinity : orgLeft
  if (paused) throw new HttpError(409, 'Email from your organisation is paused by the Croot team. Please contact us.')
  const suppressed = await suppressionOf(mail.to)
  if (suppressed) throw new HttpError(409, `${mail.to} can’t be emailed: it ${describeProblem(suppressed.reason)} earlier. Check the address with them.`)
  if (left <= 0) {
    throw new HttpError(429, `Your organisation has sent its ${limit} emails for today. The rest can go tomorrow; the limit keeps delivery reliable for everyone.`)
  }
  const messageId = await sendMail(mail)
  await prisma.emailSend.create({ data: { organisationId, category: mail.category, messageId, trigger } })
  return messageId
}
