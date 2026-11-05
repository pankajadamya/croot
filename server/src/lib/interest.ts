import { authSecret, env } from './env.js'
import { HttpError } from './http.js'
import { type Mail, sendMail } from './mailer.js'
import { prisma } from './prisma.js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { hashToken, newToken } from './tokens.js'

/**
 * "Tell me about the next retreat" sign-ups. Double opt-in (UK/EU e-marketing rules): the visitor
 * confirms from an email before anything else is ever sent. Every email carries a one-click
 * unsubscribe, which deletes the sign-up outright. Unconfirmed sign-ups are deleted after 30 days.
 */
export const interestWording = (orgName: string) => `Email me about future retreats from ${orgName}. I can unsubscribe at any time.`

const RESEND_AFTER_MS = 10 * 60 * 1000

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const link = (token: string, action: 'confirm' | 'unsubscribe') => `${env.WEB_ORIGIN}/interest/${token}${action === 'unsubscribe' ? '/unsubscribe' : ''}`

function confirmMail(to: string, orgName: string, token: string): Mail {
  const url = link(token, 'confirm')
  const text = [
    `You asked to hear about future retreats from ${orgName}.`,
    '',
    `Please confirm by opening this link: ${url}`,
    '',
    'If you didn’t ask for this, ignore this email and you won’t hear from us again.',
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:520px">
<p>You asked to hear about future retreats from <strong>${escape(orgName)}</strong>.</p>
<p><a href="${url}" style="display:inline-block;background:#183D3B;color:#F8F5EF;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Yes, keep me posted</a></p>
<p style="color:#4A5F5A;font-size:14px">If you didn’t ask for this, ignore this email and you won’t hear from us again.</p>
</div>`
  return { to, subject: `Confirm: updates from ${orgName}`, text, html, category: 'interest' }
}

/**
 * The unsubscribe link in announcements: the sign-up's id plus a keyed signature, so it never changes
 * and the link in every email the person has ever received keeps working.
 */
const unsubscribeSig = (id: string) => createHmac('sha256', authSecret).update(`interest-unsubscribe:${id}`).digest('base64url').slice(0, 22)
export function unsubscribeTokenFor(signupId: string) {
  return `${signupId.replace(/-/g, '')}.${unsubscribeSig(signupId)}`
}
function signupIdFromUnsubscribeToken(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{22})$/.exec(token)
  if (!m) return null
  const id = m[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
  const expected = Buffer.from(unsubscribeSig(id))
  const given = Buffer.from(m[2])
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null
}

/** The organiser's identity for the footer: legal name and address when set. */
export type Sender = { name: string; legalName?: string | null; legalAddress?: string | null }

export function announcementMail(to: string, sender: Sender | string, token: string, subject: string, message: string): Mail {
  const org = typeof sender === 'string' ? { name: sender } : sender
  const orgName = org.name
  const identity = org.legalName ? [org.legalName, org.legalAddress].filter(Boolean).join(', ') : null
  const unsubscribe = link(token, 'unsubscribe')
  const oneClick = `${env.WEB_ORIGIN}/api/public/interest/${token}/unsubscribe`
  const text = `${message}\n\n—\nYou’re getting this because you asked ${orgName} to tell you about future retreats.${identity ? `\nSent on behalf of ${identity}.` : ''}\nUnsubscribe: ${unsubscribe}`
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:560px;line-height:1.55">
${message
  .split(/\n{2,}/)
  .map((p) => `<p>${escape(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
  .join('\n')}
<hr style="border:0;border-top:1px solid #d9ded6;margin:24px 0">
<p style="color:#4A5F5A;font-size:13px">You’re getting this because you asked ${escape(orgName)} to tell you about future retreats.${identity ? ` Sent on behalf of ${escape(identity)}.` : ''}
<a href="${unsubscribe}">Unsubscribe</a></p>
</div>`
  return {
    to,
    subject,
    text,
    html,
    category: 'interest',
    // One-click unsubscribe in the mail app itself (RFC 8058; required by Gmail and Yahoo for bulk mail).
    headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }
}

/** Sign up (or re-send the confirmation). The reply never reveals whether an address was known. */
export async function registerInterest(opts: { organisationId: string; orgName: string; retreatId: string | null; email: string; name: string }) {
  const email = opts.email.trim().toLowerCase()
  const existing = await prisma.interestSignup.findUnique({ where: { organisationId_email: { organisationId: opts.organisationId, email } } })
  if (existing?.confirmedAt) return // already confirmed: nothing to do, and say nothing different
  if (existing?.lastMailAt && Date.now() - existing.lastMailAt.getTime() < RESEND_AFTER_MS) return // don't flood an inbox
  const token = newToken(24)
  const data = {
    tokenHash: hashToken(token),
    retreatId: opts.retreatId,
    name: opts.name.trim(),
    consentWording: interestWording(opts.orgName),
    lastMailAt: new Date(),
  }
  if (existing) await prisma.interestSignup.update({ where: { id: existing.id }, data })
  else await prisma.interestSignup.create({ data: { ...data, organisationId: opts.organisationId, email } })
  await sendMail(confirmMail(email, opts.orgName, token))
}

async function byToken(token: string) {
  const row = token.length >= 16 && token.length <= 64 ? await prisma.interestSignup.findUnique({ where: { tokenHash: hashToken(token) }, include: { organisation: { select: { name: true, slug: true } } } }) : null
  if (!row) throw new HttpError(404, 'This link has expired or was already used to unsubscribe.')
  return row
}

export async function confirmInterest(token: string) {
  const row = await byToken(token)
  if (!row.confirmedAt) await prisma.interestSignup.update({ where: { id: row.id }, data: { confirmedAt: new Date() } })
  return { orgName: row.organisation.name, orgSlug: row.organisation.slug }
}

/** Unsubscribing deletes the sign-up: nothing about the person is kept. */
export async function unsubscribeInterest(token: string) {
  // Announcement links carry the stable signed token; older emails carry a hashed one.
  const id = signupIdFromUnsubscribeToken(token)
  const row = id
    ? await prisma.interestSignup.findUnique({ where: { id }, include: { organisation: { select: { name: true, slug: true } } } })
    : await byToken(token)
  if (!row) throw new HttpError(404, 'This link has expired or was already used to unsubscribe.')
  await prisma.interestSignup.delete({ where: { id: row.id } })
  return { orgName: row.organisation.name, orgSlug: row.organisation.slug }
}
