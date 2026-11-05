import { env } from './env.js'
import { HttpError } from './http.js'
import { type Mail, sendMail } from './mailer.js'
import { prisma } from './prisma.js'
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

export function announcementMail(to: string, orgName: string, token: string, subject: string, message: string): Mail {
  const unsubscribe = link(token, 'unsubscribe')
  const text = `${message}\n\n—\nYou’re getting this because you asked ${orgName} to tell you about future retreats.\nUnsubscribe: ${unsubscribe}`
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:560px;line-height:1.55">
${message
  .split(/\n{2,}/)
  .map((p) => `<p>${escape(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
  .join('\n')}
<hr style="border:0;border-top:1px solid #d9ded6;margin:24px 0">
<p style="color:#4A5F5A;font-size:13px">You’re getting this because you asked ${escape(orgName)} to tell you about future retreats.
<a href="${unsubscribe}">Unsubscribe</a></p>
</div>`
  return { to, subject, text, html, category: 'interest' }
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
  const row = await byToken(token)
  await prisma.interestSignup.delete({ where: { id: row.id } })
  return { orgName: row.organisation.name, orgSlug: row.organisation.slug }
}
