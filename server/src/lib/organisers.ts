import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { PROCESSING_TERMS_VERSION } from '../../../shared/legal.js'
import { RESERVED_ORG_SLUGS, slugify } from '../../../shared/slug.js'
import { audit } from './audit.js'
import { env } from './env.js'
import { HttpError, text } from './http.js'
import { sendMail, type Mail } from './mailer.js'
import { prisma } from './prisma.js'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * The basic details captured before anyone gets organiser access, by request or by invite. The same
 * schema serves both, so an admin always sees the same facts about a new organiser.
 */
export const organiserDetailsSchema = z.object({
  contactName: text(120).refine((v) => v.length >= 2, 'Enter your full name'),
  phone: text(40).refine((v) => v === '' || /^[+()\d\s.-]{6,}$/.test(v), 'Enter a valid phone number').optional(),
  orgName: text(120).refine((v) => v.length >= 2, 'Enter your organisation or business name'),
  websiteUrl: z.url().max(300).optional().or(z.literal('').transform(() => undefined)),
  country: text(80).optional(),
  reviewKinds: z.array(z.enum(['itinerary', 'property'])).min(1, 'Choose at least one').max(2),
  volume: text(200).optional(),
  message: text(2000).optional(),
  acceptTerms: z.literal(true, { error: 'Please accept the data processing terms' }),
})
export type OrganiserDetails = z.infer<typeof organiserDetailsSchema>

export async function availableOrgSlug(wanted: string, db: Db = prisma) {
  const base = slugify(wanted) || 'retreats'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    if (RESERVED_ORG_SLUGS.has(candidate)) continue
    if (!(await db.organisation.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate
  }
  throw new HttpError(409, 'Choose a different organisation name')
}

/**
 * Gives a user organiser access: either a new organisation (they become its owner) or a role in an
 * existing one. Records the processing-terms acceptance on a new organisation. Call inside a transaction;
 * the slug must be looked up beforehand with availableOrgSlug (it reads outside the transaction).
 */
export async function grantOrganiser(
  tx: Prisma.TransactionClient,
  opts: {
    userId: string
    actorUserId: string
    actorKind: 'platform' | 'user'
    details: { orgName: string; websiteUrl?: string | null; email: string }
    newSlug?: string
    organisationId?: string
    role?: 'owner' | 'organiser'
  },
) {
  let organisationId = opts.organisationId
  if (!organisationId) {
    const org = await tx.organisation.create({
      data: {
        slug: opts.newSlug!,
        name: opts.details.orgName,
        contactEmail: opts.details.email,
        websiteUrl: opts.details.websiteUrl ?? null,
        dpaVersion: PROCESSING_TERMS_VERSION,
        dpaAcceptedAt: new Date(),
      },
    })
    organisationId = org.id
    await audit({ organisationId, actorUserId: opts.actorUserId, actorKind: opts.actorKind, action: 'tenant.created', entityType: 'organisation', entityId: organisationId }, tx)
  }
  const role = opts.organisationId ? (opts.role ?? 'organiser') : 'owner'
  const existing = await tx.membership.findUnique({ where: { userId_organisationId: { userId: opts.userId, organisationId } } })
  if (!existing) await tx.membership.create({ data: { userId: opts.userId, organisationId, role } })
  await audit({ organisationId, actorUserId: opts.actorUserId, actorKind: opts.actorKind, action: 'member.added', entityType: 'user', entityId: opts.userId, metadata: { role } }, tx)
  return organisationId
}

// ---------------------------------------------------------------------------------------------
// Emails. Sent best-effort: a failed email never undoes the access change; admins can resend links.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function simpleMail(to: string, subject: string, lines: string[], link?: { url: string; label: string }, category: Mail['category'] = 'organiser'): Mail {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.url}`] : [])].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:520px;line-height:1.5">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${
    link ? `<p><a href="${esc(link.url)}" style="display:inline-block;background:#183D3B;color:#F8F5EF;padding:10px 18px;border-radius:999px;text-decoration:none">${esc(link.label)}</a></p>` : ''
  }</div>`
  return { to, subject, text, html, category }
}

export function sendQuietly(mail: Mail) {
  sendMail(mail).catch((e) => console.error(`email (${mail.category}) failed:`, (e as Error).message))
}

export const organiserMails = {
  approved: (to: string, name: string, orgName: string) =>
    simpleMail(
      to,
      'You’re now an organiser on croot',
      [`Hello ${name},`, `Your request was approved. You’re the owner of ${orgName} on croot and can start creating review programmes.`, 'Sign in with this email address to get started.'],
      { url: `${env.WEB_ORIGIN}/signin`, label: 'Sign in to croot' },
    ),
  declined: (to: string, name: string, reason?: string | null) =>
    simpleMail(to, 'Your croot organiser request', [
      `Hello ${name},`,
      'Thank you for your interest in croot. We aren’t able to give organiser access at the moment.',
      ...(reason ? [`Note from the croot team: ${reason}`] : []),
      'You can still sign in to see any reviews you’ve been invited to give.',
    ]),
  invite: (to: string, url: string, orgName: string | null, days: number) =>
    simpleMail(
      to,
      'You’re invited to be an organiser on croot',
      [
        'Hello,',
        orgName ? `You’ve been invited to join ${orgName} as an organiser on croot.` : 'You’ve been invited to become an organiser on croot, to collect reviews from your retreat guests.',
        `Open the link, sign in with this email address (${to}) and add a few details. The link works once and expires in ${days} days.`,
      ],
      { url, label: 'Accept invitation' },
    ),
  newRequest: (to: string, who: string, orgName: string) =>
    simpleMail(to, `New organiser request: ${orgName}`, [`${who} asked to become an organiser for ${orgName}.`], {
      url: `${env.WEB_ORIGIN}/platform`,
      label: 'Review the request',
    }),
}

/** Tells every active admin about a new request (addresses never leave the server). */
export async function notifyAdmins(who: string, orgName: string) {
  const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true, active: true }, select: { email: true } })
  for (const a of admins) sendQuietly(organiserMails.newRequest(a.email, who, orgName))
}
