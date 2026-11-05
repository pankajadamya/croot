import type { Request } from 'express'
import { DEFAULT_THEME, type ThemeTokens } from '../../../shared/themes.js'
import { platformHosts } from './env.js'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'

/** Which tenant (if any) owns the requesting hostname: a custom domain maps straight to its site. */
export async function tenantForHost(req: Request) {
  const host = (req.hostname || '').toLowerCase()
  if (!host || platformHosts.has(host)) return null
  const domain = await prisma.orgDomain.findUnique({
    where: { hostname: host },
    include: { organisation: { select: { id: true, slug: true, name: true, status: true } } },
  })
  return domain?.organisation.status === 'active' ? domain.organisation : null
}

export async function activeOrgBySlug(slug: string) {
  const org = await prisma.organisation.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, status: true, websiteUrl: true } })
  if (!org || org.status !== 'active') throw new HttpError(404, 'Not found')
  return org
}

/** A retreat visible on the public site (never drafts). */
export async function publicRetreat(orgId: string, retreatSlug: string) {
  const retreat = await prisma.retreat.findUnique({ where: { organisationId_slug: { organisationId: orgId, slug: retreatSlug } } })
  if (!retreat || retreat.status === 'draft' || retreat.status === 'archived') throw new HttpError(404, 'Not found')
  return retreat
}

export async function publishedTheme(retreatId: string): Promise<ThemeTokens> {
  const theme = await prisma.themeRevision.findFirst({ where: { retreatId, status: 'published' }, orderBy: { createdAt: 'desc' } })
  // Merge over the default so a revision saved before a token existed still renders completely.
  return { ...DEFAULT_THEME.tokens, ...((theme?.tokens as Partial<ThemeTokens> | undefined) ?? {}) }
}

export async function publishedContent(retreatId: string) {
  const now = new Date()
  const content = await prisma.contentRevision.findFirst({
    where: { retreatId, status: 'published', OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
    orderBy: { createdAt: 'desc' },
  })
  return content && { headline: content.headline, introParagraphs: content.introParagraphs, ctaLabel: content.ctaLabel, ctaUrl: content.ctaUrl }
}

/** Public projection of the retreat facts panel. Contact details only once the organiser enables them. */
export function retreatFacts(r: Awaited<ReturnType<typeof publicRetreat>>) {
  return {
    slug: r.slug,
    kind: r.kind,
    title: r.title,
    startDate: r.kind === 'itinerary' ? r.startDate : null,
    endDate: r.kind === 'itinerary' ? r.endDate : null,
    locationSummary: r.locationSummary,
    routeSummary: r.kind === 'itinerary' ? r.routeSummary.slice(0, 4) : [],
    propertyAddress: r.kind === 'property' ? r.propertyAddress : null,
    amenities: r.kind === 'property' ? r.amenities.slice(0, 6) : [],
    itineraryUrl: r.itineraryUrl,
    retreatPageUrl: r.retreatPageUrl,
    organiserName: r.organiserName,
    contact: r.contactPublic ? { email: r.contactEmail, phone: r.contactPhone } : null,
    privacyUrl: r.privacyUrl,
  }
}
