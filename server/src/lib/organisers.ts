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
  websiteUrl: z.url({ protocol: /^https?$/ }).max(300).optional().or(z.literal('').transform(() => undefined)),
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
      'You’re now an organiser on Croot',
      [`Hello ${name},`, `Your request was approved. You’re the owner of ${orgName} on Croot and can start creating review programmes.`, 'Sign in with this email address to get started.'],
      { url: `${env.WEB_ORIGIN}/signin`, label: 'Sign in to Croot' },
    ),
  declined: (to: string, name: string, reason?: string | null) =>
    simpleMail(to, 'Your Croot organiser request', [
      `Hello ${name},`,
      'Thank you for your interest in Croot. We aren’t able to give organiser access at the moment.',
      ...(reason ? [`Note from the Croot team: ${reason}`] : []),
      'You can still sign in to see any reviews you’ve been invited to give.',
    ]),
  invite: (to: string, url: string, orgName: string | null, days: number) =>
    simpleMail(
      to,
      'You’re invited to be an organiser on Croot',
      [
        'Hello,',
        orgName ? `You’ve been invited to join ${orgName} as an organiser on Croot.` : 'You’ve been invited to become an organiser on Croot, to collect reviews from your retreat guests.',
        `Open the link, sign in with this email address (${to}) and add a few details. The link works once and expires in ${days} days.`,
      ],
      { url, label: 'Accept invitation' },
    ),
  /** Someone was added to an organisation's team (by an owner, or by the Croot team when it was set up). */
  addedToTeam: (to: string, opts: { name: string; orgName: string; orgSlug: string; by: string; role: 'owner' | 'organiser' }) =>
    simpleMail(
      to,
      `You’ve been added to ${opts.orgName} on Croot`,
      [
        `Hello ${opts.name},`,
        `${opts.by} added you to ${opts.orgName} on Croot as ${opts.role === 'owner' ? 'an owner' : 'an organiser'}, to collect and publish reviews from your guests.`,
        `Sign in with this email address (${to}). We’ll email you a one-time code, so there’s no password to remember. You can also use Google if this is a Google address.`,
      ],
      { url: `${env.WEB_ORIGIN}/signin?next=${encodeURIComponent(`/admin/${opts.orgSlug}`)}`, label: 'Sign in to Croot' },
    ),
  /** For admins: someone started as an organiser by themselves. Nothing to approve; this is for awareness. */
  newOrganiser: (to: string, who: string, orgName: string, orgSlug: string) =>
    simpleMail(
      to,
      `New organiser on Croot: ${orgName}`,
      [
        `${who} became an organiser and created ${orgName} (/${orgSlug}). They can use it straight away.`,
        'Their details are in the admin console, where you can suspend the organisation if anything looks wrong.',
      ],
      { url: `${env.WEB_ORIGIN}/platform`, label: 'Open the admin console' },
    ),
}

/** Tells every active admin about a new organiser (addresses never leave the server). */
export async function notifyAdmins(who: string, orgName: string, orgSlug: string) {
  const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true, active: true }, select: { email: true } })
  for (const a of admins) sendQuietly(organiserMails.newOrganiser(a.email, who, orgName, orgSlug))
}
