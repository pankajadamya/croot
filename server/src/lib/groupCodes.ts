import { createHmac, randomInt } from 'node:crypto'
import { normaliseEmail, sendOrgMail } from './emailGuard.js'
import { authSecret, env } from './env.js'
import { HttpError } from './http.js'
import { groupJoinCodeEmail } from './mailer.js'
import { prisma } from './prisma.js'
import { safeEqual } from './tokens.js'

/**
 * Email codes for guests who joined by a group link: they gave only a name, so on the thank-you page
 * they may add an email and prove it with a code (optional, like everyone else's verification).
 * Codes are HMAC'd with a server secret, single use, short-lived, with a few attempts; at most a few
 * per address per hour, and every code counts against the organisation's daily email limit.
 */
const CODES_PER_ADDRESS_PER_HOUR = 5
const MAX_ATTEMPTS = 5

const hmac = (retreatId: string, email: string, code: string) => createHmac('sha256', authSecret).update(`group:${retreatId}:${email}:${code}`).digest('hex')

export async function sendGroupCode(opts: { organisationId: string; retreatId: string; retreatTitle: string; email: string; name: string }) {
  const email = normaliseEmail(opts.email)
  const recent = await prisma.groupJoinCode.count({ where: { retreatId: opts.retreatId, email, createdAt: { gt: new Date(Date.now() - 3600_000) } } })
  if (recent >= CODES_PER_ADDRESS_PER_HOUR) return // answers the same way; just sends nothing more this hour
  await prisma.groupJoinCode.updateMany({ where: { retreatId: opts.retreatId, email, consumedAt: null }, data: { consumedAt: new Date() } })
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await prisma.groupJoinCode.create({
    data: { retreatId: opts.retreatId, email, name: opts.name, codeHash: hmac(opts.retreatId, email, code), expiresAt: new Date(Date.now() + env.LOGIN_CODE_TTL_MINUTES * 60_000) },
  })
  await sendOrgMail(opts.organisationId, groupJoinCodeEmail(email, code, opts.retreatTitle, env.LOGIN_CODE_TTL_MINUTES))
}

/** Checks a code; throws 401 when it's wrong, expired, used or out of attempts. */
export async function checkGroupCode(retreatId: string, rawEmail: string, rawCode: string) {
  const email = normaliseEmail(rawEmail)
  const code = rawCode.replace(/\s+/g, '')
  const invalid = new HttpError(401, 'That code is not valid or has expired. Request a new one.')
  const row = await prisma.groupJoinCode.findFirst({ where: { retreatId, email, consumedAt: null }, orderBy: { createdAt: 'desc' } })
  if (!row || row.expiresAt < new Date() || row.attempts >= MAX_ATTEMPTS) throw invalid
  const claimed = await prisma.groupJoinCode.updateMany({ where: { id: row.id, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } })
  if (!claimed.count || !/^\d{6}$/.test(code) || !safeEqual(hmac(retreatId, email, code), row.codeHash)) throw invalid
  const consumed = await prisma.groupJoinCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } })
  if (!consumed.count) throw invalid
  return email
}

/** The account for a just-proven address (created if new), for signing the guest in. */
export async function verifiedUserFor(email: string, name: string) {
  const user = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, name, emailVerifiedAt: new Date() } }))
  if (!user.active) throw new HttpError(403, 'This account is not active.')
  if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })
  return user
}
