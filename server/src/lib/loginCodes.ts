import { createHmac, randomInt } from 'node:crypto'
import { authSecret, env } from './env.js'
import { loginCodeEmail, sendMail } from './mailer.js'
import { prisma } from './prisma.js'
import { safeEqual } from './tokens.js'

/**
 * Email one-time codes. A 6-digit code has only a million values, so it is protected by:
 *   - HMAC with a server secret (a database leak alone does not reveal or let anyone test codes)
 *   - a short expiry, single use, and MAX_ATTEMPTS wrong guesses before the code is dead
 *   - per-email and per-IP rate limits on requesting codes (rateLimits.ts / requestCode below)
 */
const MAX_ATTEMPTS = 5
const MAX_CODES_PER_HOUR = 5

function hmac(email: string, code: string) {
  return createHmac('sha256', authSecret).update(`${email}:${code}`).digest('hex')
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase()
}

/**
 * Who may get a new account by email or Google: invited guests (their invitation proves the address
 * belongs to a guest of an active organisation), and anyone when organiser sign-up is switched on.
 */
export async function mayCreateAccount(email: string) {
  if (env.ORG_SIGNUP_ENABLED) return true
  const guest = await prisma.attendee.findFirst({ where: { email, retreat: { organisation: { status: 'active' } } }, select: { id: true } })
  return Boolean(guest)
}

/**
 * Issues a code if appropriate and always resolves the same way, so the response never reveals
 * whether an address has an account. Sign-in for an unknown address sends nothing. Sign-up for a
 * known address sends a sign-in code instead (the person may simply have forgotten).
 */
export async function requestCode(rawEmail: string, purpose: 'signin' | 'signup', name?: string) {
  const email = normaliseEmail(rawEmail)
  const recent = await prisma.loginCode.count({ where: { email, createdAt: { gt: new Date(Date.now() - 3600_000) } } })
  if (recent >= MAX_CODES_PER_HOUR) return

  const user = await prisma.user.findUnique({ where: { email }, select: { active: true } })
  if (user && !user.active) return
  if (purpose === 'signup' && !env.ORG_SIGNUP_ENABLED) return
  // Existing account: always a sign-in code. New address: only if an account may be created for it.
  let effective: 'signin' | 'signup' = 'signin'
  if (!user) {
    if (!(await mayCreateAccount(email))) return
    effective = 'signup'
  }

  // A new code replaces any earlier unused one.
  await prisma.loginCode.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: new Date() } })
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await prisma.loginCode.create({
    data: {
      email,
      codeHash: hmac(email, code),
      purpose: effective,
      name: effective === 'signup' ? (name ?? null) : null,
      expiresAt: new Date(Date.now() + env.LOGIN_CODE_TTL_MINUTES * 60_000),
    },
  })
  // Not awaited: the provider's response time must not reveal that this address has an account.
  sendMail(loginCodeEmail(email, code, effective, env.LOGIN_CODE_TTL_MINUTES)).catch((e) => console.error('login code email failed:', (e as Error).message))
}

export type VerifyResult = { ok: true; userId: string; created: boolean } | { ok: false }

/** Checks a code and returns the (possibly newly created) verified user. */
export async function verifyCode(rawEmail: string, code: string): Promise<VerifyResult> {
  const email = normaliseEmail(rawEmail)
  const row = await prisma.loginCode.findFirst({ where: { email, consumedAt: null }, orderBy: { createdAt: 'desc' } })
  if (!row || row.expiresAt < new Date() || row.attempts >= MAX_ATTEMPTS) return { ok: false }
  if (!/^\d{6}$/.test(code) || !safeEqual(hmac(email, code), row.codeHash)) {
    await prisma.loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    return { ok: false }
  }
  // Single use, and race-safe: only one request can consume it.
  const consumed = await prisma.loginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } })
  if (!consumed.count) return { ok: false }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (!existing.active) return { ok: false }
    if (!existing.emailVerifiedAt) await prisma.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } })
    return { ok: true, userId: existing.id, created: false }
  }
  if (row.purpose !== 'signup' || !(await mayCreateAccount(email))) return { ok: false }
  const user = await prisma.user.create({
    data: { email, name: row.name?.trim() || email.split('@')[0], emailVerifiedAt: new Date() },
  })
  return { ok: true, userId: user.id, created: true }
}
