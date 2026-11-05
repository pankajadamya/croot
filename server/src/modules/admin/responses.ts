import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { SCALE_LABELS, type FeedbackCategory } from '../../../../shared/categories.js'
import { autoExcerpt } from '../../../../shared/excerpt.js'
import { audit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { HttpError, parseBody, route, text, uuidParam } from '../../lib/http.js'
import { prisma } from '../../lib/prisma.js'
import { addPhotoToLive, dropPhotoFromLive, publishResponse, takeDown } from '../../lib/publication.js'
import { storage } from '../../lib/storage.js'
import { tenantMedia, tenantResponse, tenantRetreat } from '../../lib/tenant.js'
import { tenantOf } from '../../middleware/auth.js'

export const responsesRouter = Router({ mergeParams: true })

const listQuery = z.object({
  status: z.enum(['submitted', 'changes_requested', 'withdrawn', 'all']).default('all'),
  publication: z.enum(['none', 'published', 'unpublished', 'withdrawn', 'all']).default('all'),
  queue: z.enum(['ready', 'requests', 'all']).default('all'),
  q: z.string().max(100).optional(),
})

/** Submitted responses only: drafts never appear in the organiser's review queue. */
responsesRouter.get(
  '/retreats/:retreatId/responses',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const q = listQuery.parse(req.query)
    const where: Prisma.ResponseWhereInput = {
      organisationId: t.org.id,
      retreatId: retreat.id,
      status: q.status === 'all' ? { not: 'draft' } : q.status,
      ...(q.publication !== 'all' ? { publicationStatus: q.publication } : {}),
      ...(q.queue === 'requests' ? { changeRequests: { some: { status: 'open' } } } : {}),
      ...(q.queue === 'ready' ? { consentPublicText: true, storyText: { not: '' }, publicationStatus: { in: ['none', 'unpublished'] }, status: 'submitted' } : {}),
      ...(q.q ? { OR: [{ attendee: { name: { contains: q.q, mode: 'insensitive' } } }, { storyText: { contains: q.q, mode: 'insensitive' } }] } : {}),
    }
    const rows = await prisma.response.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 500,
      include: {
        attendee: { select: { name: true } },
        _count: { select: { media: { where: { removedAt: null } }, changeRequests: { where: { status: 'open' } } } },
      },
    })
    // A guest may edit and resend a published review; the older approved words stay live until republished.
    const published = rows.filter((r) => r.publicationStatus === 'published').map((r) => r.id)
    const lastPublished = new Map<string, Date>()
    for (const p of await prisma.publicationRevision.findMany({
      where: { responseId: { in: published }, status: 'published' },
      orderBy: { createdAt: 'asc' },
      select: { responseId: true, createdAt: true },
    })) {
      lastPublished.set(p.responseId, p.createdAt)
    }
    res.json({
      responses: rows.map((r) => ({
        id: r.id,
        updatedSincePublished: Boolean(r.submittedAt && lastPublished.get(r.id) && r.submittedAt > lastPublished.get(r.id)!),
        attendeeName: r.attendee.name,
        status: r.status,
        publicationStatus: r.publicationStatus,
        submittedAt: r.submittedAt,
        hasStory: r.storyText.trim().length > 0,
        storyPreview: autoExcerpt(r.storyText, 140),
        consentPublicText: r.consentPublicText,
        consentFirstName: r.consentFirstName,
        photoCount: r._count.media,
        openChangeRequests: r._count.changeRequests,
        pinned: r.pinned,
      })),
    })
  }),
)

responsesRouter.get(
  '/responses/:responseId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const id = uuidParam(req, 'responseId')
    const r = await prisma.response.findFirst({
      where: { id, organisationId: t.org.id, status: { not: 'draft' } },
      include: {
        attendee: { select: { name: true, email: true, stayStart: true, stayEnd: true } },
        retreat: { select: { id: true, title: true, slug: true, kind: true, feedbackCategories: true } },
        ratings: true,
        media: { where: { removedAt: null }, orderBy: { displayOrder: 'asc' } },
        consents: { orderBy: { createdAt: 'desc' } },
        publications: { orderBy: { createdAt: 'desc' } },
        changeRequests: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!r) throw new HttpError(404, 'Response not found')
    const live = r.publications[0]?.status === 'published' ? r.publications[0] : null
    const categories = r.retreat.feedbackCategories as unknown as FeedbackCategory[]
    res.set('Cache-Control', 'no-store')
    res.json({
      id: r.id,
      retreat: { id: r.retreat.id, title: r.retreat.title, slug: r.retreat.slug },
      attendee: {
        name: r.attendee.name,
        email: r.consentFollowUp ? r.attendee.email : null,
        stay: r.retreat.kind === 'property' ? { start: r.attendee.stayStart, end: r.attendee.stayEnd } : null,
      },
      status: r.status,
      submittedAt: r.submittedAt,
      organiserMessage: r.organiserMessage,
      publicStory: {
        title: r.storyTitle,
        text: r.storyText,
        submittedText: (r.submittedSnapshot as { storyText?: string } | null)?.storyText ?? null,
        overallRating: r.overallRating,
        suggestedExcerpt: autoExcerpt(r.storyText),
      },
      privateFeedback: {
        ratings: categories.map((c) => {
          const x = r.ratings.find((rt) => rt.categoryKey === c.key)
          return { key: c.key, label: c.label, score: x?.score ?? null, notApplicable: x?.notApplicable ?? false, comment: x?.comment ?? '' }
        }),
        keepText: r.keepText,
        changeText: r.changeText,
        followUpOk: r.consentFollowUp,
      },
      consents: {
        publicText: r.consentPublicText,
        firstName: r.consentFirstName,
        followUp: r.consentFollowUp,
        marketing: r.consentMarketing,
        wordingVersion: r.consentWordingVersion,
        history: r.consents.map((c) => ({ scope: c.scope, granted: c.granted, actor: c.actor, wordingVersion: c.wordingVersion, at: c.createdAt })),
      },
      photos: r.media.map((m) => ({
        id: m.id,
        previewUrl: `/api/admin/orgs/${t.org.slug}/media/${m.id}/preview`,
        altText: m.altText,
        caption: m.caption,
        publishConsent: m.publishConsent,
        moderation: m.moderation,
        albumConsent: m.albumConsent,
        live: Boolean(live?.photoIds.includes(m.id)),
      })),
      publication: {
        status: r.publicationStatus,
        publicSlug: r.publicSlug,
        pinned: r.pinned,
        live: live && { excerpt: live.excerpt, displayName: live.displayName, photoIds: live.photoIds, at: live.createdAt },
        history: r.publications.map((p) => ({ status: p.status, reason: p.reason, at: p.createdAt, photoCount: p.photoIds.length, excerpt: p.excerpt })),
      },
      changeRequests: r.changeRequests.map((c) => ({ id: c.id, kind: c.kind, message: c.message, status: c.status, createdAt: c.createdAt })),
    })
  }),
)

const publishSchema = z.object({ excerpt: z.string().max(1000).optional(), photoIds: z.array(z.uuid()).max(20).default([]), reason: text(500).optional() })

responsesRouter.post(
  '/responses/:responseId/publish',
  route(async (req, res) => {
    const t = tenantOf(req)
    const response = await tenantResponse(t.org.id, uuidParam(req, 'responseId'))
    const body = parseBody(publishSchema, req.body)
    const result = await publishResponse({ organisationId: t.org.id, responseId: response.id, reviewerId: t.userId, ...body })
    res.json({ publicSlug: result.publicSlug, url: `/stories/${result.publicSlug}` })
  }),
)

responsesRouter.post(
  '/responses/:responseId/unpublish',
  route(async (req, res) => {
    const t = tenantOf(req)
    const response = await tenantResponse(t.org.id, uuidParam(req, 'responseId'))
    const body = parseBody(z.object({ reason: text(500).refine((v) => v.length > 0, 'Give a reason for the audit log') }), req.body)
    await takeDown({ organisationId: t.org.id, responseId: response.id, status: 'unpublished', reason: body.reason, actorUserId: t.userId, actorKind: 'user' })
    res.json({ ok: true })
  }),
)

/**
 * Organisers never edit a guest's words. To change them, they explain what and why; the guest's
 * invite link becomes editable again and the guest resubmits in their own words.
 */
responsesRouter.post(
  '/responses/:responseId/request-changes',
  route(async (req, res) => {
    const t = tenantOf(req)
    const response = await tenantResponse(t.org.id, uuidParam(req, 'responseId'))
    if (response.status !== 'submitted') throw new HttpError(409, 'Only submitted responses can be returned to the guest')
    const body = parseBody(z.object({ message: text(2000).refine((v) => v.length > 0, 'Explain what should change') }), req.body)
    await prisma.response.update({ where: { id: response.id }, data: { status: 'changes_requested', organiserMessage: body.message } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'response.changes_requested', entityType: 'response', entityId: response.id })
    res.json({ ok: true })
  }),
)

responsesRouter.post(
  '/responses/:responseId/pin',
  route(async (req, res) => {
    const t = tenantOf(req)
    const response = await tenantResponse(t.org.id, uuidParam(req, 'responseId'))
    const body = parseBody(z.object({ pinned: z.boolean() }), req.body)
    if (body.pinned && response.publicationStatus !== 'published') throw new HttpError(409, 'Only published stories can be pinned')
    await prisma.response.update({ where: { id: response.id }, data: { pinned: body.pinned } })
    res.json({ ok: true })
  }),
)

responsesRouter.post(
  '/change-requests/:id/resolve',
  route(async (req, res) => {
    const t = tenantOf(req)
    const id = uuidParam(req, 'id')
    const updated = await prisma.changeRequest.updateMany({ where: { id, organisationId: t.org.id, status: 'open' }, data: { status: 'resolved', resolvedAt: new Date() } })
    if (!updated.count) throw new HttpError(404, 'Request not found')
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'change_request.resolved', entityType: 'change_request', entityId: id })
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// Guest photo moderation and private preview

responsesRouter.post(
  '/media/:mediaId/moderate',
  route(async (req, res) => {
    const t = tenantOf(req)
    const media = await tenantMedia(t.org.id, uuidParam(req, 'mediaId'))
    const body = parseBody(z.object({ status: z.enum(['approved', 'rejected', 'pending']), note: text(300).optional() }), req.body)
    // A guest photo can be approved when the guest allowed it with their story or in the album.
    if (media.kind === 'guest' && body.status === 'approved' && !media.publishConsent && !media.albumConsent) {
      throw new HttpError(409, 'The guest has not consented to publishing this photo')
    }
    await prisma.mediaAsset.update({ where: { id: media.id }, data: { moderation: body.status } })
    if (body.status === 'approved' && media.responseId) {
      await addPhotoToLive({ organisationId: t.org.id, responseId: media.responseId, photoId: media.id, actorUserId: t.userId })
    } else if (body.status !== 'approved' && media.responseId) {
      await dropPhotoFromLive({ organisationId: t.org.id, responseId: media.responseId, photoId: media.id, reason: body.note || 'Photo not approved', actorUserId: t.userId })
    }
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: `media.${body.status}`, entityType: 'media', entityId: media.id })
    res.json({ ok: true })
  }),
)

/** Authorised organiser preview of any image in this tenant (metadata-stripped derivative only). */
responsesRouter.get(
  '/media/:mediaId/preview',
  route(async (req, res) => {
    const t = tenantOf(req)
    const media = await tenantMedia(t.org.id, uuidParam(req, 'mediaId'))
    const bytes = await storage.get(media.derivativeKey)
    if (!bytes) throw new HttpError(404, 'Image not found')
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }).send(bytes)
  }),
)

// ---------------------------------------------------------------------------------------------
// Anonymous notes: no link to any attendee, response or invitation exists to follow.

const MIN_ANONYMOUS_NOTES = 3

responsesRouter.get(
  '/retreats/:retreatId/anonymous',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const notes = await prisma.anonymousNote.findMany({
      where: { organisationId: t.org.id, retreatId: retreat.id },
      // Alphabetical: never the order they arrived in, which could hint at who sent which.
      orderBy: { message: 'asc' },
      select: { message: true },
    })
    res.set('Cache-Control', 'no-store')
    // Held back until a few have arrived, so a new note can't be matched to the review sent just before it.
    const held = notes.length < MIN_ANONYMOUS_NOTES
    res.json({ notes: held ? [] : notes, held: held ? notes.length : 0, minimum: MIN_ANONYMOUS_NOTES })
  }),
)

// ---------------------------------------------------------------------------------------------
// Private insights

responsesRouter.get(
  '/retreats/:retreatId/insights',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const submitted = await prisma.response.count({ where: { retreatId: retreat.id, organisationId: t.org.id, status: { in: ['submitted', 'changes_requested'] } } })
    const categories = retreat.feedbackCategories as unknown as FeedbackCategory[]
    if (submitted < retreat.aggregateThreshold) {
      return res.json({ submitted, threshold: retreat.aggregateThreshold, hidden: true, categories: [] })
    }
    const ratings = await prisma.feedbackRating.groupBy({
      by: ['categoryKey', 'score', 'notApplicable'],
      where: { organisationId: t.org.id, response: { retreatId: retreat.id, status: { in: ['submitted', 'changes_requested'] } } },
      _count: true,
    })
    res.json({
      submitted,
      threshold: retreat.aggregateThreshold,
      hidden: false,
      categories: categories.map((c) => {
        const rows = ratings.filter((r) => r.categoryKey === c.key)
        const distribution = [1, 2, 3, 4, 5].map((s) => ({ score: s, label: SCALE_LABELS[s], count: rows.filter((r) => r.score === s).reduce((n, r) => n + r._count, 0) }))
        const answered = distribution.reduce((n, d) => n + d.count, 0)
        const mean = answered ? distribution.reduce((n, d) => n + d.score * d.count, 0) / answered : null
        return {
          key: c.key,
          label: c.label,
          answered,
          notApplicable: rows.filter((r) => r.notApplicable).reduce((n, r) => n + r._count, 0),
          mean: mean === null ? null : Math.round(mean * 10) / 10,
          distribution,
        }
      }),
    })
  }),
)

responsesRouter.get(
  '/retreats/:retreatId/export/private-feedback.csv',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const categories = retreat.feedbackCategories as unknown as FeedbackCategory[]
    const rows = await prisma.response.findMany({
      where: { organisationId: t.org.id, retreatId: retreat.id, status: { in: ['submitted', 'changes_requested'] } },
      include: { attendee: { select: { name: true } }, ratings: true },
      orderBy: { submittedAt: 'asc' },
    })
    const header = ['Guest', 'Submitted', ...categories.flatMap((c) => [c.label, `${c.label} — comment`]), 'Keep', 'Change', 'Happy to be contacted']
    const body = rows.map((r) => [
      r.attendee.name,
      r.submittedAt?.toISOString().slice(0, 10),
      ...categories.flatMap((c) => {
        const x = r.ratings.find((rt) => rt.categoryKey === c.key)
        return [x?.notApplicable ? 'N/A' : x?.score ?? '', x?.comment ?? '']
      }),
      r.keepText,
      r.changeText,
      r.consentFollowUp ? 'Yes' : 'No',
    ])
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'export.private_feedback', entityType: 'retreat', entityId: retreat.id, metadata: { rows: rows.length } })
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${retreat.slug}-private-feedback.csv"`, 'Cache-Control': 'no-store' })
    res.send('﻿' + toCsv([header, ...body]))
  }),
)
