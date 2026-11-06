import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { Invitation, Prisma } from '@prisma/client'
import { CONSENT_WORDING_VERSION, type FeedbackCategory } from '../../../shared/categories.js'
import { firstName } from '../../../shared/slug.js'
import { addContribution, albumListing, albumSummary, sendAlbumPhoto, sendTeaser, setAlbumSharing } from '../lib/album.js'
import { altFor } from '../lib/altText.js'
import { audit } from '../lib/audit.js'
import { env } from '../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../lib/http.js'
import { processImage } from '../lib/images.js'
import { canEdit, ensureResponse, resolveInvite, type ResolvedInvite } from '../lib/invites.js'
import { prisma } from '../lib/prisma.js'
import { publishedContent } from '../lib/site.js'
import { storage } from '../lib/storage.js'
import { removeObjects } from '../lib/storageCleanup.js'
import { hashToken, receiptTokenFor } from '../lib/tokens.js'
import { tokenLimiter, uploadLimiter } from '../middleware/rateLimits.js'

/**
 * A guest's review, reached two ways:
 *   /api/invites/:token          the unique link (no account needed to start, save and resume)
 *   /api/me/reviews/:attendeeId  a signed-in guest whose verified email matches the invitation
 * Once a review has been sent, changing it (text, ratings, photos, resubmitting) requires the
 * signed-in route or a signed-in session on the link: see requireEditable().
 */
type Review = Omit<ResolvedInvite, 'invitation'> & { invitation: Invitation | null }

const reviewRoutes = Router({ mergeParams: true })
const current = (res: Response): Review => res.locals.review as Review

/** True when the request comes from a signed-in user who proved they own the invited address. */
function signedInAsGuest(req: Request, r: Review) {
  return Boolean(req.auth?.emailVerified && req.auth.user.email === r.attendee.email)
}

export const invitesRouter = Router()
invitesRouter.use(
  '/:token',
  tokenLimiter,
  route(async (req, res, next) => {
    res.locals.review = await resolveInvite(req.params.token)
    next()
  }),
  reviewRoutes,
)

export const myReviewsRouter = Router()

/** Every review addressed to the signed-in guest's verified email, across organisations. */
myReviewsRouter.get(
  '/',
  route(async (req, res) => {
    if (!req.auth!.emailVerified) return res.json({ reviews: [], emailVerified: false })
    const rows = await prisma.attendee.findMany({
      where: { email: req.auth!.user.email, retreat: { status: { in: ['collecting', 'closed'] }, organisation: { status: 'active' } } },
      include: {
        retreat: { select: { title: true, kind: true, startDate: true, endDate: true, organisation: { select: { name: true } } } },
        response: { select: { status: true, submittedAt: true, publicationStatus: true, publicSlug: true, updatedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      emailVerified: true,
      reviews: rows.map((a) => ({
        attendeeId: a.id,
        programme: a.retreat.title,
        kind: a.retreat.kind,
        organisation: a.retreat.organisation.name,
        startDate: a.retreat.kind === 'property' ? a.stayStart : a.retreat.startDate,
        endDate: a.retreat.kind === 'property' ? a.stayEnd : a.retreat.endDate,
        status: a.response?.status ?? 'not_started',
        submittedAt: a.response?.submittedAt ?? null,
        publication: a.response?.publicationStatus ?? 'none',
        storyUrl: a.response?.publicationStatus === 'published' && a.response.publicSlug ? `/stories/${a.response.publicSlug}` : null,
      })),
    })
  }),
)

myReviewsRouter.use(
  '/:attendeeId',
  route(async (req, res, next) => {
    res.locals.review = await resolveForGuest(req)
    next()
  }),
  reviewRoutes,
)

async function resolveForGuest(req: Request): Promise<Review> {
  const id = uuidParam(req, 'attendeeId')
  if (!req.auth?.emailVerified) throw new HttpError(403, 'Sign in with your email to see your reviews')
  const attendee = await prisma.attendee.findFirst({
    where: { id, email: req.auth.user.email },
    include: { retreat: { include: { organisation: { select: { id: true, slug: true, name: true, status: true } } } }, response: true },
  })
  if (!attendee) throw new HttpError(404, 'Review not found')
  const { retreat } = attendee
  if (retreat.organisation.status !== 'active' || retreat.status === 'archived' || retreat.status === 'draft') throw new HttpError(404, 'Review not found')
  const invitation = await prisma.invitation.findFirst({ where: { attendeeId: id, revokedAt: null }, orderBy: { issuedAt: 'desc' } })
  return { invitation, attendee, retreat, response: attendee.response }
}


const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 } })

function categoriesOf(r: Review): FeedbackCategory[] {
  return (r.retreat.feedbackCategories as unknown as FeedbackCategory[]) ?? []
}

async function draftView(r: Review, req: Request) {
  const response = r.response
    ? await prisma.response.findUnique({
        where: { id: r.response.id },
        include: { ratings: true, media: { where: { removedAt: null }, orderBy: { displayOrder: 'asc' } } },
      })
    : null
  const slideshow = await prisma.mediaAsset.findMany({
        where: {
          organisationId: r.retreat.organisationId,
          retreatId: r.retreat.id,
          kind: 'organiser',
          inHeroSlideshow: true,
          moderation: 'approved',
          publishConsent: true,
          removedAt: null,
        },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, altText: true, caption: true },
      })
  return {
    firstName: firstName(r.attendee.name),
    editable: canEdit(r) && (!r.response?.submittedAt || signedInAsGuest(req, r)),
    // A sent review can be changed only after signing in with the invited email address.
    signIn: {
      required: Boolean(r.response?.submittedAt),
      signedIn: signedInAsGuest(req, r),
      canReopen: r.response?.status === 'submitted' && r.retreat.status === 'collecting',
    },
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
      // Where the anonymous note goes: by retreat only, so no token or attendee key crosses over.
      anonymousNotePath: `/api/public/notes/${r.retreat.id}`,
      // The retreat's public page (details and published reviews), once it's live.
      publicPagePath: r.retreat.status === 'draft' || r.retreat.status === 'archived' ? null : `/o/${r.retreat.organisation.slug}/r/${r.retreat.slug}`,
      privacyNoticePath: `/o/${r.retreat.organisation.slug}/privacy?programme=${r.retreat.slug}`,
      slideshow: slideshow.map((s) => ({ url: `/media/${s.id}`, alt: altFor(s), caption: s.caption })),
      // The organiser's published opening (the same words as the public page), shown on the welcome step.
      opening: await publishedContent(r.retreat.id).then((c) => c && { headline: c.headline, introParagraphs: c.introParagraphs }),
      // Itinerary retreats: the thank-you photo album, teased before sending and unlocked after.
      album: await albumSummary(r.retreat, r.response, req.baseUrl),
      albumSharingAvailable: r.retreat.kind === 'itinerary' && r.retreat.rewardAlbumEnabled,
    },
    // Property stays: the guest's own dates, prefilled by the organiser when known, editable by the guest.
    stay: r.retreat.kind === 'property' ? { start: r.attendee.stayStart, end: r.attendee.stayEnd } : null,
    response: response && {
      status: response.status,
      revision: response.revision,
      currentStep: response.currentStep,
      storyTitle: response.storyTitle,
      storyText: response.storyText,
      overallRating: response.overallRating,
      keepText: response.keepText,
      changeText: response.changeText,
      consents: {
        publicText: response.consentPublicText,
        firstName: response.consentFirstName,
        followUp: response.consentFollowUp,
        marketing: response.consentMarketing,
        photoMarketing: response.consentPhotoMarketing,
      },
      ratings: response.ratings.map((x) => ({ categoryKey: x.categoryKey, score: x.score, notApplicable: x.notApplicable, comment: x.comment })),
      photos: response.media.map((m) => ({ id: m.id, altText: m.altText, caption: m.caption, publishConsent: m.publishConsent, albumConsent: m.albumConsent, width: m.width, height: m.height })),
      submittedAt: response.submittedAt,
      organiserMessage: response.status === 'changes_requested' ? response.organiserMessage : null,
      updatedAt: response.updatedAt,
    },
  }
}

reviewRoutes.get(
  '/',
  route(async (req, res) => {
    const r = current(res)
    if (r.invitation && !r.invitation.openedAt) {
      await prisma.invitation.update({ where: { id: r.invitation.id }, data: { openedAt: new Date(), lastUsedAt: new Date() } })
    }
    res.set('Cache-Control', 'no-store')
    res.json(await draftView(r, req))
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
  storyTitle: text(120).optional(),
  storyText: text(8000).optional(),
  overallRating: z.number().int().min(1).max(5).nullable().optional(),
  keepText: text(2000).optional(),
  changeText: text(2000).optional(),
  ratings: z.array(ratingSchema).max(30).optional(),
  consents: z
    .object({ publicText: z.boolean(), firstName: z.boolean(), followUp: z.boolean(), marketing: z.boolean(), photoMarketing: z.boolean().nullable() })
    .partial()
    .optional(),
  stay: z.object({ start: z.iso.date().nullable(), end: z.iso.date().nullable() }).optional(),
})

function requireEditable(req: Request, res: Response) {
  const r = current(res)
  if (r.response?.submittedAt && !signedInAsGuest(req, r)) {
    throw new HttpError(401, 'To change a review you have already sent, sign in with the email address you were invited on.', { signInRequired: true })
  }
  if (!canEdit(r)) throw new HttpError(409, 'This response can no longer be edited. You can still view it from your private response link.')
  return r
}

reviewRoutes.put(
  '/draft',
  route(async (req, res) => {
    const r = requireEditable(req, res)
    const body = parseBody(draftSchema, req.body)
    const response = await ensureResponse(r)
    const keys = new Set(categoriesOf(r).map((c) => c.key))

    const data: Prisma.ResponseUpdateManyMutationInput = { revision: { increment: 1 } }
    if (body.currentStep !== undefined) data.currentStep = body.currentStep
    if (body.storyTitle !== undefined) data.storyTitle = body.storyTitle
    if (body.storyText !== undefined) data.storyText = body.storyText
    if (body.overallRating !== undefined) data.overallRating = body.overallRating
    if (body.keepText !== undefined) data.keepText = body.keepText
    if (body.changeText !== undefined) data.changeText = body.changeText
    if (body.consents?.publicText !== undefined) data.consentPublicText = body.consents.publicText
    if (body.consents?.firstName !== undefined) data.consentFirstName = body.consents.firstName
    if (body.consents?.followUp !== undefined) data.consentFollowUp = body.consents.followUp
    if (body.consents?.marketing !== undefined) data.consentMarketing = body.consents.marketing
    const photoMarketing = body.consents?.photoMarketing
    if (typeof photoMarketing === 'boolean') data.consentPhotoMarketing = photoMarketing
    const stay = r.retreat.kind === 'property' && body.stay ? body.stay : null
    if (stay?.start && stay.end && stay.end < stay.start) throw new HttpError(400, 'Check-out is before check-in', { stay: ['Check-out is before check-in'] })

    const saved = await prisma.$transaction(async (tx) => {
      // Optimistic concurrency: a stale tab cannot overwrite newer text from another device.
      const updated = await tx.response.updateMany({ where: { id: response.id, revision: body.revision }, data })
      if (updated.count === 0) {
        throw new HttpError(409, 'This response was updated somewhere else. Reload to see the latest version.', { conflict: true })
      }
      if (stay) {
        await tx.attendee.update({
          where: { id: r.attendee.id },
          data: { stayStart: stay.start ? new Date(`${stay.start}T00:00:00Z`) : null, stayEnd: stay.end ? new Date(`${stay.end}T00:00:00Z`) : null },
        })
      }
      if (typeof photoMarketing === 'boolean') {
        await tx.mediaAsset.updateMany({ where: { responseId: response.id, removedAt: null }, data: { publishConsent: photoMarketing } })
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
    if (r.invitation) await prisma.invitation.update({ where: { id: r.invitation.id }, data: { lastUsedAt: new Date() } })
    res.json({ revision: saved.revision, savedAt: saved.updatedAt })
  }),
)

reviewRoutes.post(
  '/photos',
  uploadLimiter,
  upload.single('photo'),
  route(async (req, res) => {
    const r = requireEditable(req, res)
    if (!req.file) throw new HttpError(400, 'Choose a photo to upload')
    const response = await ensureResponse(r)
    const count = await prisma.mediaAsset.count({ where: { responseId: response.id, removedAt: null } })
    if (count >= env.MAX_PHOTOS_PER_RESPONSE) throw new HttpError(409, `You can add up to ${env.MAX_PHOTOS_PER_RESPONSE} photos`)
    const image = await processImage(req.file.buffer, req.body.takenAt)
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
        takenAt: image.takenAt,
        displayOrder: count,
        // Adding a photo shares it in the album; its use on the website and social media follows the
        // guest's own Yes/No answer (off until they say yes).
        publishConsent: response.consentPhotoMarketing === true,
      },
    })
    const shared = r.retreat.kind === 'itinerary' && r.retreat.rewardAlbumEnabled
      ? await setAlbumSharing(response, asset.id, true)
      : asset
    res.status(201).json({ id: shared.id, altText: '', caption: '', publishConsent: shared.publishConsent, albumConsent: shared.albumConsent, width: shared.width, height: shared.height })
  }),
)

const photoPatch = z.object({
  altText: text(300).optional(),
  caption: text(300).optional(),
  publishConsent: z.boolean().optional(),
  /** Share in the group album (fellow reviewers and anyone with its share link). Opt-in, separate from publishing. */
  albumConsent: z.boolean().optional(),
})

async function ownPhoto(r: Review, photoId: string) {
  const photo = r.response
    ? await prisma.mediaAsset.findFirst({ where: { id: photoId, responseId: r.response.id, removedAt: null } })
    : null
  if (!photo) throw new HttpError(404, 'Photo not found')
  return photo
}

reviewRoutes.patch(
  '/photos/:photoId',
  route(async (req, res) => {
    const r = requireEditable(req, res)
    const photo = await ownPhoto(r, uuidParam(req, 'photoId'))
    const body = parseBody(photoPatch, req.body)
    const { albumConsent, ...rest } = body
    let updated = await prisma.mediaAsset.update({ where: { id: photo.id }, data: rest })
    if (albumConsent !== undefined && r.response) updated = await setAlbumSharing(r.response, photo.id, albumConsent)
    res.json({ id: updated.id, altText: updated.altText, caption: updated.caption, publishConsent: updated.publishConsent, albumConsent: updated.albumConsent })
  }),
)

reviewRoutes.delete(
  '/photos/:photoId',
  route(async (req, res) => {
    const r = requireEditable(req, res)
    const photo = await ownPhoto(r, uuidParam(req, 'photoId'))
    await prisma.mediaAsset.update({ where: { id: photo.id }, data: { removedAt: new Date(), publishConsent: false } })
    await removeObjects([photo.originalKey, photo.derivativeKey])
    res.status(204).end()
  }),
)

/** The guest's own preview of their upload (private, never cached). */
// ---- Thank-you photo album (unlocked by sending the review) ----

reviewRoutes.get(
  '/album',
  route(async (req, res) => {
    const r = current(res)
    res.set('Cache-Control', 'no-store')
    res.json(
      await albumListing(r.retreat, r.response, req.baseUrl, {
        orgName: r.retreat.organisation.name,
        retreatPath: `/o/${r.retreat.organisation.slug}/r/${r.retreat.slug}`,
      }),
    )
  }),
)

reviewRoutes.get(
  '/album/teaser/:photoId',
  route(async (req, res) => {
    await sendTeaser(res, current(res).retreat, uuidParam(req, 'photoId'))
  }),
)

reviewRoutes.post(
  '/album/photos',
  uploadLimiter,
  upload.single('photo'),
  route(async (req, res) => {
    const r = current(res)
    if (!req.file) throw new HttpError(400, 'Choose a photo to add')
    const asset = await addContribution(r.retreat, r.response, req.file.buffer, req.body.takenAt)
    res.status(201).json({ id: asset.id })
  }),
)

reviewRoutes.delete(
  '/album/photos/:photoId',
  route(async (req, res) => {
    const r = current(res)
    if (!r.response) throw new HttpError(404, 'Photo not found')
    await setAlbumSharing(r.response, uuidParam(req, 'photoId'), false)
    res.status(204).end()
  }),
)

reviewRoutes.get(
  '/album/:photoId',
  route(async (req, res) => {
    const r = current(res)
    await sendAlbumPhoto(res, r.retreat, r.response, uuidParam(req, 'photoId'))
  }),
)

reviewRoutes.get(
  '/photos/:photoId/image',
  route(async (req, res) => {
    const r = current(res)
    const photo = await ownPhoto(r, uuidParam(req, 'photoId'))
    const bytes = await storage.get(photo.derivativeKey)
    if (!bytes) throw new HttpError(404, 'Photo not found')
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }).send(bytes)
  }),
)

/**
 * A signed-in guest reopens their sent review to change it. The published version (the words they
 * approved earlier) stays live until the organiser approves the update.
 */
reviewRoutes.post(
  '/reopen',
  route(async (req, res) => {
    const r = current(res)
    if (!signedInAsGuest(req, r)) {
      throw new HttpError(401, 'Sign in with the email address you were invited on to change your review.', { signInRequired: true })
    }
    if (r.response?.status !== 'submitted') throw new HttpError(409, 'This review is not waiting to be changed')
    if (r.retreat.status !== 'collecting') throw new HttpError(409, 'Reviews for this programme are closed. Contact the organiser to change yours.')
    await prisma.response.update({ where: { id: r.response.id }, data: { status: 'changes_requested', organiserMessage: null } })
    await audit({ organisationId: r.retreat.organisationId, actorUserId: req.auth!.user.id, actorKind: 'attendee', action: 'response.reopened_by_guest', entityType: 'response', entityId: r.response.id })
    res.json({ ok: true })
  }),
)

const submitSchema = z.object({ revision: z.number().int().min(0) })

reviewRoutes.post(
  '/submit',
  route(async (req, res) => {
    const r = current(res)
    const body = parseBody(submitSchema, req.body)

    // Idempotent: asking again after sending re-shows the same private link (it never changes).
    if (r.response?.status === 'submitted') {
      // Anyone holding a forwarded invitation must not get the private link (it can erase and export).
      if (!signedInAsGuest(req, r)) {
        throw new HttpError(401, 'Sign in with the email address you were invited on to open your private response page.', { signInRequired: true })
      }
      const receiptToken = receiptTokenFor(r.response.id)
      await prisma.response.update({ where: { id: r.response.id }, data: { receiptTokenHash: hashToken(receiptToken) } })
      return res.json({ receiptToken, alreadySubmitted: true })
    }
    requireEditable(req, res)
    const response = await ensureResponse(r)
    if (response.revision !== body.revision) {
      throw new HttpError(409, 'This response was updated somewhere else. Reload to see the latest version.', { conflict: true })
    }

    const receiptToken = receiptTokenFor(response.id)
    await prisma.$transaction(async (tx) => {
      const full = await tx.response.findUniqueOrThrow({
        where: { id: response.id },
        include: { media: { where: { removedAt: null } } },
      })
      if (full.media.length > 0 && full.consentPhotoMarketing === null) {
        throw new HttpError(400, 'Please answer whether the organiser can use your photos on their website and social media.', { photoMarketing: ['Choose yes or no'] })
      }
      const scopes: Array<[string, boolean]> = [
        ['public_text', full.consentPublicText],
        ['first_name', full.consentFirstName],
        ['follow_up', full.consentFollowUp],
        ['marketing', full.consentMarketing],
        ...(full.media.length > 0 ? [['photo_marketing', full.consentPhotoMarketing === true] as [string, boolean]] : []),
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
            storyTitle: full.storyTitle,
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
