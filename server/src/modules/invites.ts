import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { CONSENT_WORDING_VERSION, type FeedbackCategory } from '../../../shared/categories.js'
import { firstName } from '../../../shared/slug.js'
import { audit } from '../lib/audit.js'
import { env } from '../lib/env.js'
import { HttpError, param, parseBody, route, text, uuidParam } from '../lib/http.js'
import { processImage } from '../lib/images.js'
import { canEdit, ensureResponse, resolveInvite, type ResolvedInvite } from '../lib/invites.js'
import { prisma } from '../lib/prisma.js'
import { storage } from '../lib/storage.js'
import { hashToken, newToken } from '../lib/tokens.js'
import { tokenLimiter, uploadLimiter } from '../middleware/rateLimits.js'

export const invitesRouter = Router()
invitesRouter.use(tokenLimiter)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 } })

function categoriesOf(r: ResolvedInvite): FeedbackCategory[] {
  return (r.retreat.feedbackCategories as unknown as FeedbackCategory[]) ?? []
}

async function draftView(r: ResolvedInvite) {
  const response = r.response
    ? await prisma.response.findUnique({
        where: { id: r.response.id },
        include: { ratings: true, media: { where: { removedAt: null }, orderBy: { displayOrder: 'asc' } } },
      })
    : null
  const slideshow = r.retreat.writingSlideshowEnabled
    ? await prisma.mediaAsset.findMany({
        where: {
          organisationId: r.retreat.organisationId,
          retreatId: r.retreat.id,
          kind: 'organiser',
          inWritingSlideshow: true,
          moderation: 'approved',
          publishConsent: true,
          removedAt: null,
        },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, altText: true, caption: true },
      })
    : []
  return {
    firstName: firstName(r.attendee.name),
    editable: canEdit(r),
    retreat: {
      kind: r.retreat.kind,
      title: r.retreat.title,
      // Property guests see their own stay; itinerary guests see the retreat dates.
      startDate: r.retreat.kind === 'property' ? r.attendee.stayStart : r.retreat.startDate,
      endDate: r.retreat.kind === 'property' ? r.attendee.stayEnd : r.retreat.endDate,
      organiserName: r.retreat.organiserName,
      organisationName: r.retreat.organisation.name,
      categories: categoriesOf(r),
      privacyUrl: r.retreat.privacyUrl,
      // The anonymous page is addressed by public slugs only: no token or attendee key crosses over.
      anonymousPath: `/o/${r.retreat.organisation.slug}/r/${r.retreat.slug}/anonymous`,
      privacyNoticePath: `/o/${r.retreat.organisation.slug}/privacy?programme=${r.retreat.slug}`,
      slideshow: slideshow.map((s) => ({ url: `/media/${s.id}`, alt: s.altText, caption: s.caption })),
    },
    response: response && {
      status: response.status,
      revision: response.revision,
      currentStep: response.currentStep,
      storyText: response.storyText,
      overallRating: response.overallRating,
      keepText: response.keepText,
      changeText: response.changeText,
      consents: {
        publicText: response.consentPublicText,
        firstName: response.consentFirstName,
        followUp: response.consentFollowUp,
        marketing: response.consentMarketing,
      },
      ratings: response.ratings.map((x) => ({ categoryKey: x.categoryKey, score: x.score, notApplicable: x.notApplicable, comment: x.comment })),
      photos: response.media.map((m) => ({ id: m.id, altText: m.altText, caption: m.caption, publishConsent: m.publishConsent, width: m.width, height: m.height })),
      submittedAt: response.submittedAt,
      organiserMessage: response.status === 'changes_requested' ? response.organiserMessage : null,
      updatedAt: response.updatedAt,
    },
  }
}

invitesRouter.get(
  '/:token',
  route(async (req, res) => {
    const r = await resolveInvite(req.params.token)
    if (!r.invitation.openedAt) {
      await prisma.invitation.update({ where: { id: r.invitation.id }, data: { openedAt: new Date(), lastUsedAt: new Date() } })
    }
    res.set('Cache-Control', 'no-store')
    res.json(await draftView(r))
  }),
)

const ratingSchema = z.object({
  categoryKey: z.string().max(40),
  score: z.number().int().min(1).max(5).nullable(),
  notApplicable: z.boolean(),
  comment: text(1000).default(''),
})

const draftSchema = z.object({
  revision: z.number().int().min(0),
  currentStep: z.number().int().min(0).max(10).optional(),
  storyText: text(8000).optional(),
  overallRating: z.number().int().min(1).max(5).nullable().optional(),
  keepText: text(2000).optional(),
  changeText: text(2000).optional(),
  ratings: z.array(ratingSchema).max(30).optional(),
  consents: z
    .object({ publicText: z.boolean(), firstName: z.boolean(), followUp: z.boolean(), marketing: z.boolean() })
    .partial()
    .optional(),
})

async function requireEditable(token: unknown) {
  const r = await resolveInvite(token)
  if (!canEdit(r)) throw new HttpError(409, 'This response can no longer be edited. You can still view it from your private response link.')
  return r
}

invitesRouter.put(
  '/:token/draft',
  route(async (req, res) => {
    const r = await requireEditable(req.params.token)
    const body = parseBody(draftSchema, req.body)
    const response = await ensureResponse(r)
    const keys = new Set(categoriesOf(r).map((c) => c.key))

    const data: Prisma.ResponseUpdateManyMutationInput = { revision: { increment: 1 } }
    if (body.currentStep !== undefined) data.currentStep = body.currentStep
    if (body.storyText !== undefined) data.storyText = body.storyText
    if (body.overallRating !== undefined) data.overallRating = body.overallRating
    if (body.keepText !== undefined) data.keepText = body.keepText
    if (body.changeText !== undefined) data.changeText = body.changeText
    if (body.consents?.publicText !== undefined) data.consentPublicText = body.consents.publicText
    if (body.consents?.firstName !== undefined) data.consentFirstName = body.consents.firstName
    if (body.consents?.followUp !== undefined) data.consentFollowUp = body.consents.followUp
    if (body.consents?.marketing !== undefined) data.consentMarketing = body.consents.marketing

    const saved = await prisma.$transaction(async (tx) => {
      // Optimistic concurrency: a stale tab cannot overwrite newer text from another device.
      const updated = await tx.response.updateMany({ where: { id: response.id, revision: body.revision }, data })
      if (updated.count === 0) {
        throw new HttpError(409, 'This response was updated somewhere else. Reload to see the latest version.', { conflict: true })
      }
      for (const rating of body.ratings ?? []) {
        if (!keys.has(rating.categoryKey)) continue
        const value = { score: rating.notApplicable ? null : rating.score, notApplicable: rating.notApplicable, comment: rating.comment }
        await tx.feedbackRating.upsert({
          where: { responseId_categoryKey: { responseId: response.id, categoryKey: rating.categoryKey } },
          update: value,
          create: { organisationId: response.organisationId, responseId: response.id, categoryKey: rating.categoryKey, ...value },
        })
      }
      return tx.response.findUniqueOrThrow({ where: { id: response.id }, select: { revision: true, updatedAt: true } })
    })
    await prisma.invitation.update({ where: { id: r.invitation.id }, data: { lastUsedAt: new Date() } })
    res.json({ revision: saved.revision, savedAt: saved.updatedAt })
  }),
)

invitesRouter.post(
  '/:token/photos',
  uploadLimiter,
  upload.single('photo'),
  route(async (req, res) => {
    const r = await requireEditable(req.params.token)
    if (!req.file) throw new HttpError(400, 'Choose a photo to upload')
    const response = await ensureResponse(r)
    const count = await prisma.mediaAsset.count({ where: { responseId: response.id, removedAt: null } })
    if (count >= env.MAX_PHOTOS_PER_RESPONSE) throw new HttpError(409, `You can add up to ${env.MAX_PHOTOS_PER_RESPONSE} photos`)
    const image = await processImage(req.file.buffer)
    const id = crypto.randomUUID()
    const prefix = `org/${r.retreat.organisationId}/retreat/${r.retreat.id}/guest/${id}`
    await storage.put(`${prefix}/original`, image.original, image.originalMime)
    await storage.put(`${prefix}/web.webp`, image.derivative, 'image/webp')
    const asset = await prisma.mediaAsset.create({
      data: {
        id,
        organisationId: r.retreat.organisationId,
        retreatId: r.retreat.id,
        responseId: response.id,
        kind: 'guest',
        originalKey: `${prefix}/original`,
        derivativeKey: `${prefix}/web.webp`,
        mime: image.originalMime,
        sizeBytes: image.original.length,
        width: image.width,
        height: image.height,
        displayOrder: count,
      },
    })
    res.status(201).json({ id: asset.id, altText: '', caption: '', publishConsent: false, width: asset.width, height: asset.height })
  }),
)

const photoPatch = z.object({
  altText: text(300).optional(),
  caption: text(300).optional(),
  publishConsent: z.boolean().optional(),
})

async function ownPhoto(r: ResolvedInvite, photoId: string) {
  const photo = r.response
    ? await prisma.mediaAsset.findFirst({ where: { id: photoId, responseId: r.response.id, removedAt: null } })
    : null
  if (!photo) throw new HttpError(404, 'Photo not found')
  return photo
}

invitesRouter.patch(
  '/:token/photos/:photoId',
  route(async (req, res) => {
    const r = await requireEditable(req.params.token)
    const photo = await ownPhoto(r, uuidParam(req, 'photoId'))
    const body = parseBody(photoPatch, req.body)
    const updated = await prisma.mediaAsset.update({ where: { id: photo.id }, data: body })
    res.json({ id: updated.id, altText: updated.altText, caption: updated.caption, publishConsent: updated.publishConsent })
  }),
)

invitesRouter.delete(
  '/:token/photos/:photoId',
  route(async (req, res) => {
    const r = await requireEditable(req.params.token)
    const photo = await ownPhoto(r, uuidParam(req, 'photoId'))
    await prisma.mediaAsset.update({ where: { id: photo.id }, data: { removedAt: new Date(), publishConsent: false } })
    await Promise.all([storage.remove(photo.originalKey), storage.remove(photo.derivativeKey)]).catch(() => {})
    res.status(204).end()
  }),
)

/** The guest's own preview of their upload (private, never cached). */
invitesRouter.get(
  '/:token/photos/:photoId/image',
  route(async (req, res) => {
    const r = await resolveInvite(req.params.token)
    const photo = await ownPhoto(r, uuidParam(req, 'photoId'))
    const bytes = await storage.get(photo.derivativeKey)
    if (!bytes) throw new HttpError(404, 'Photo not found')
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }).send(bytes)
  }),
)

const submitSchema = z.object({ revision: z.number().int().min(0) })

invitesRouter.post(
  '/:token/submit',
  route(async (req, res) => {
    const token = param(req, 'token')
    const r = await resolveInvite(token)
    const body = parseBody(submitSchema, req.body)

    // Idempotent: a retried submit after success issues a fresh receipt link rather than a duplicate.
    if (r.response?.status === 'submitted') {
      const receiptToken = newToken()
      await prisma.response.update({ where: { id: r.response.id }, data: { receiptTokenHash: hashToken(receiptToken) } })
      return res.json({ receiptToken, alreadySubmitted: true })
    }
    if (!canEdit(r)) throw new HttpError(409, 'This response can no longer be submitted.')
    const response = await ensureResponse(r)
    if (response.revision !== body.revision) {
      throw new HttpError(409, 'This response was updated somewhere else. Reload to see the latest version.', { conflict: true })
    }

    const receiptToken = newToken()
    await prisma.$transaction(async (tx) => {
      const full = await tx.response.findUniqueOrThrow({
        where: { id: response.id },
        include: { media: { where: { removedAt: null } } },
      })
      const scopes: Array<[string, boolean]> = [
        ['public_text', full.consentPublicText],
        ['first_name', full.consentFirstName],
        ['follow_up', full.consentFollowUp],
        ['marketing', full.consentMarketing],
        ...full.media.map((m): [string, boolean] => [`photo:${m.id}`, m.publishConsent]),
      ]
      await tx.consentEvent.createMany({
        data: scopes.map(([scope, granted]) => ({
          organisationId: full.organisationId,
          responseId: full.id,
          scope,
          granted,
          wordingVersion: CONSENT_WORDING_VERSION,
          actor: 'attendee' as const,
        })),
      })
      await tx.response.update({
        where: { id: full.id },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          consentWordingVersion: CONSENT_WORDING_VERSION,
          receiptTokenHash: hashToken(receiptToken),
          organiserMessage: null,
          revision: { increment: 1 },
          submittedSnapshot: {
            storyText: full.storyText,
            overallRating: full.overallRating,
            consents: Object.fromEntries(scopes),
            photoIds: full.media.map((m) => m.id),
            submittedAt: new Date().toISOString(),
          },
        },
      })
      await audit(
        { organisationId: full.organisationId, actorKind: 'attendee', action: 'response.submitted', entityType: 'response', entityId: full.id },
        tx,
      )
    })
    res.json({ receiptToken, alreadySubmitted: false })
  }),
)
