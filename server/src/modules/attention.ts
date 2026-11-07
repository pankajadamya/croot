import { Router } from 'express'
import { PROCESSING_TERMS_VERSION } from '../../../shared/legal.js'
import { route } from '../lib/http.js'
import { normaliseEmail, suppressedAmong } from '../lib/emailGuard.js'
import { prisma } from '../lib/prisma.js'
import { requireUser } from '../middleware/auth.js'

/**
 * The notifications bell: everything waiting on this person, worked out from live data each time.
 * An item goes away by itself once it's dealt with (a request resolved, a story published, a photo
 * approved), so there's nothing to mark as read, except anonymous notes, which are counted as seen
 * when the organiser opens them. Queries run one after another (PGlite takes one at a time).
 */
export interface AttentionItem {
  id: string
  /** Who it's for: the organisation's name, or "Admin". */
  scope: string
  title: string
  detail?: string
  href: string
  /** Shown in red: a guest is waiting on a reply, or a deadline applies. */
  urgent?: boolean
  at?: string
}

const MIN_ANONYMOUS_NOTES = 3
/** An organisation's bounces in a day that count as a spike (with at least this share of its sends). */
const SPIKE_BOUNCES = 3
const SPIKE_BOUNCE_RATE = 0.05
const MAX_PER_KIND = 20
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const excerpt = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const oneMonthAfter = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate())
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

export async function organisationAttention(org: { id: string; slug: string; name: string; status: string }, membership: { seenNoteCounts: unknown } | null) {
  const items: AttentionItem[] = []
  const base = `/admin/${org.slug}`
  const scope = org.name

  if (org.status === 'pending') {
    items.push({ id: `org-pending:${org.id}`, scope, title: 'Your organisation is waiting for approval', detail: 'Invitations and public pages switch on once an admin approves it.', href: base })
  }

  // Guests' messages: asking to change or withdraw a review they sent.
  const requests = await prisma.changeRequest.findMany({
    where: { organisationId: org.id, status: 'open' },
    orderBy: { createdAt: 'asc' },
    take: MAX_PER_KIND,
    select: { id: true, kind: true, message: true, createdAt: true, responseId: true, response: { select: { attendee: { select: { name: true } } } } },
  })
  for (const r of requests) {
    const who = r.response.attendee.name || 'A guest'
    items.push({
      id: `request:${r.id}`,
      scope,
      title: r.kind === 'withdraw' ? `${who} asked to withdraw their review` : `${who} asked to change their review`,
      detail: [r.message ? `“${excerpt(r.message)}”` : null, r.kind === 'withdraw' ? `Reply by ${day(oneMonthAfter(r.createdAt))}.` : null].filter(Boolean).join(' '),
      href: `${base}/responses/${r.responseId}`,
      urgent: true,
      at: r.createdAt.toISOString(),
    })
  }

  const retreats = await prisma.retreat.findMany({
    where: { organisationId: org.id, status: { not: 'archived' } },
    select: { id: true, title: true, kind: true, rewardAlbumEnabled: true },
  })
  const seen = (membership?.seenNoteCounts ?? {}) as Record<string, number>

  for (const retreat of retreats) {
    const ws = `${base}/retreats/${retreat.id}`

    // Stories the guest agreed to publish, not yet published.
    const ready = await prisma.response.count({
      where: { organisationId: org.id, retreatId: retreat.id, status: 'submitted', consentPublicText: true, storyText: { not: '' }, publicationStatus: { in: ['none', 'unpublished'] } },
    })
    if (ready) {
      items.push({ id: `ready:${retreat.id}`, scope, title: `${plural(ready, 'story', 'stories')} ready to publish`, detail: retreat.title, href: `${ws}/responses?queue=ready` })
    }

    // Published stories the guest has since updated: the old version stays live until approved.
    const published = await prisma.response.findMany({
      where: { organisationId: org.id, retreatId: retreat.id, status: 'submitted', publicationStatus: 'published' },
      select: { id: true, submittedAt: true, attendee: { select: { name: true } }, publications: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
    })
    for (const r of published) {
      const live = r.publications[0]?.createdAt
      if (live && r.submittedAt && r.submittedAt > live) {
        items.push({ id: `updated:${r.id}`, scope, title: `${r.attendee.name || 'A guest'} updated their published story`, detail: `${retreat.title}. The earlier version stays live until you approve the update.`, href: `${base}/responses/${r.id}`, at: r.submittedAt.toISOString() })
      }
    }

    // Guest photos waiting for approval: for the album, and with stories already published.
    const sent = { submittedAt: { not: null }, status: { not: 'withdrawn' as const } }
    const albumPhotos = retreat.kind === 'itinerary'
      ? await prisma.mediaAsset.count({ where: { retreatId: retreat.id, kind: 'guest', removedAt: null, moderation: 'pending', albumConsent: true, response: sent } })
      : 0
    if (albumPhotos) {
      items.push({ id: `album:${retreat.id}`, scope, title: `${plural(albumPhotos, 'guest photo')} waiting for the album`, detail: retreat.title, href: `${ws}#album-title` })
    }
    const storyPhotos = await prisma.mediaAsset.groupBy({
      by: ['responseId'],
      where: { retreatId: retreat.id, kind: 'guest', removedAt: null, moderation: 'pending', publishConsent: true, response: { ...sent, publicationStatus: 'published' } },
      _count: { _all: true },
    })
    for (const g of storyPhotos) {
      if (!g.responseId) continue
      items.push({ id: `story-photos:${g.responseId}`, scope, title: `${plural(g._count._all, 'photo')} to approve for a published story`, detail: retreat.title, href: `${base}/responses/${g.responseId}` })
    }

    // Guests whose email address bounced or complained: they won't get invitations or reminders.
    const guests = await prisma.attendee.findMany({ where: { organisationId: org.id, retreatId: retreat.id }, select: { name: true, email: true } })
    const problems = await suppressedAmong(guests.flatMap((g) => (g.email ? [g.email] : [])))
    const bad = guests.filter((g) => g.email && problems.has(normaliseEmail(g.email)))
    if (bad.length) {
      const names = bad.slice(0, 3).map((g) => g.name || g.email).join(', ') + (bad.length > 3 ? ' and others' : '')
      items.push({
        id: `bounced:${retreat.id}`,
        scope,
        title: bad.length === 1 ? `${names}’s email isn’t reaching them` : `${plural(bad.length, 'guest email')} aren’t reaching them`,
        detail: `${bad.length > 1 ? `${names}. ` : ''}Check the address with them and correct it. ${retreat.title}.`,
        href: `${ws}/invitations`,
        urgent: true,
      })
    }

    // Anonymous notes this person hasn't seen (shown only once a few have arrived).
    const notes = await prisma.anonymousNote.count({ where: { organisationId: org.id, retreatId: retreat.id } })
    const unseen = notes >= MIN_ANONYMOUS_NOTES ? notes - (seen[retreat.id] ?? 0) : 0
    if (membership && unseen > 0) {
      items.push({ id: `notes:${retreat.id}`, scope, title: `${plural(unseen, 'new anonymous note')}`, detail: retreat.title, href: `${ws}/anonymous` })
    }
  }

  // Privacy details guests are shown before they're invited.
  const settings = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id }, select: { legalName: true, legalAddress: true, privacyEmail: true, dpaVersion: true } })
  if (!settings.legalName || !settings.legalAddress || !settings.privacyEmail) {
    items.push({ id: `privacy:${org.id}`, scope, title: 'Add your privacy details', detail: 'Your legal name, address and privacy email appear in your guest privacy notice and invitation emails.', href: `${base}/privacy` })
  } else if (settings.dpaVersion !== PROCESSING_TERMS_VERSION) {
    items.push({ id: `terms:${org.id}`, scope, title: 'Review the updated data processing terms', href: `${base}/privacy` })
  }
  return items
}

export async function platformAttention() {
  const items: AttentionItem[] = []
  const scope = 'Admin'
  const requests = await prisma.tenantRequest.count({ where: { status: 'pending' } })
  if (requests) items.push({ id: 'platform:requests', scope, title: `${plural(requests, 'organiser request')} to review`, href: '/platform#pf-requests', urgent: true })
  const pendingOrgs = await prisma.organisation.count({ where: { status: 'pending' } })
  if (pendingOrgs) items.push({ id: 'platform:orgs', scope, title: `${plural(pendingOrgs, 'organisation')} waiting for approval`, href: '/platform#pf-tenants' })
  // An organisation whose mail is bouncing or being marked as spam harms delivery for everyone.
  const since = new Date(Date.now() - 24 * 3600_000)
  const feedback = await prisma.emailFeedback.groupBy({ by: ['organisationId', 'kind'], where: { createdAt: { gt: since }, organisationId: { not: null } }, _count: { _all: true } })
  const perOrg = new Map<string, { bounced: number; complained: number }>()
  for (const f of feedback) {
    const row = perOrg.get(f.organisationId!) ?? { bounced: 0, complained: 0 }
    row[f.kind] += f._count._all
    perOrg.set(f.organisationId!, row)
  }
  for (const [organisationId, n] of perOrg) {
    const sent = await prisma.emailSend.count({ where: { organisationId, sentAt: { gt: since } } })
    const bounceRate = sent ? n.bounced / sent : 0
    // A spike: any complaint, or several bounces making up a noticeable share of the day's sends.
    if (n.complained === 0 && !(n.bounced >= SPIKE_BOUNCES && bounceRate >= SPIKE_BOUNCE_RATE)) continue
    const org = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { name: true, emailPaused: true } })
    if (!org || org.emailPaused) continue
    items.push({
      id: `platform:email:${organisationId}`,
      scope,
      title: `${org.name}: email problems in the last day`,
      detail: [n.bounced ? plural(n.bounced, 'bounce') : null, n.complained ? plural(n.complained, 'spam complaint') : null].filter(Boolean).join(', ') + ` from ${plural(sent, 'email')} sent. Consider pausing its email.`,
      href: '/platform#pf-tenants',
      urgent: true,
    })
  }
  const failing = await prisma.pendingStorageDeletion.count({ where: { attempts: { gte: 3 } } })
  if (failing) {
    items.push({ id: 'platform:storage', scope, title: `${plural(failing, 'file')} could not be deleted`, detail: 'Storage deletions are still failing after several retries. Check the object storage.', href: '/platform', urgent: true })
  }
  return items
}

export const attentionRouter = Router()
attentionRouter.use(requireUser)

attentionRouter.get(
  '/',
  route(async (req, res) => {
    const user = req.auth!.user
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, organisation: { status: { not: 'suspended' } } },
      select: { seenNoteCounts: true, organisation: { select: { id: true, slug: true, name: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const items: AttentionItem[] = []
    if (user.isPlatformAdmin) items.push(...(await platformAttention()))
    for (const m of memberships) items.push(...(await organisationAttention(m.organisation, m)))
    res.set('Cache-Control', 'no-store')
    res.json({ items })
  }),
)
