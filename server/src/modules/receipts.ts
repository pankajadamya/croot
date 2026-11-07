import { confirmOwnCode, sendOwnCode, verificationView } from '../lib/ownVerify.js'
import { imageKey } from '../lib/images.js'
import { Router } from 'express'
import { z } from 'zod'
import { CONSENT_WORDING_VERSION } from '../../../shared/categories.js'
import { audit } from '../lib/audit.js'
import { HttpError, parseBody, route, text, uuidParam } from '../lib/http.js'
import multer from 'multer'
import { addContribution, albumListing, albumSummary, sendAlbumPhoto, setAlbumSharing } from '../lib/album.js'
import { env } from '../lib/env.js'
import { eraseAttendee, exportGuestData } from '../lib/gdpr.js'
import { prisma } from '../lib/prisma.js'
import { storage } from '../lib/storage.js'
import { dropNameFromLive, dropPhotoFromLive, livePublication, takeDown } from '../lib/publication.js'
import { hashToken, looksLikeToken } from '../lib/tokens.js'
import { linkCodeLimiter, linkGuessLimiter, linkLimiter, linkUploadLimiter } from '../middleware/rateLimits.js'
import { guestInterestSignup, guestInterestView } from '../lib/guestInterest.js'

const albumUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 } })

/**
 * The guest's private receipt: view what they sent, see its publication state, withdraw consent
 * (effective immediately) or ask the organiser for an edit. It never exposes anonymous notes.
 */
export const receiptsRouter = Router()
receiptsRouter.use(linkGuessLimiter, linkLimiter)

const INVALID = 'This link is not valid. Please use the most recent link you were given.'

async function resolveReceipt(token: unknown) {
  if (!looksLikeToken(token)) throw new HttpError(404, INVALID)
  const response = await prisma.response.findUnique({
    where: { receiptTokenHash: hashToken(token) },
    include: {
      retreat: {
        select: {
          id: true,
          organisationId: true,
          slug: true,
          kind: true,
          title: true,
          organiserName: true,
          contactEmail: true,
          startDate: true,
          endDate: true,
          filmMusic: true,
          filmStyle: true,
          rewardAlbumEnabled: true,
          rewardAlbumUrl: true,
          rewardAlbumNote: true,
          rewardAlbumCoverId: true,
          albumShareToken: true,
          status: true,
          organisation: { select: { name: true, slug: true, privacyEmail: true } },
        },
      },
      media: { where: { removedAt: null }, orderBy: { displayOrder: 'asc' } },
      changeRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
      attendee: { select: { id: true, name: true, email: true, source: true } },
    },
  })
  if (!response) throw new HttpError(404, INVALID)
  return response
}

receiptsRouter.get(
  '/:token',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    const live = await livePublication(response.id)
    res.set('Cache-Control', 'no-store')
    res.json({
      retreat: {
        title: response.retreat.title,
        organiserName: response.retreat.organiserName,
        organisationName: response.retreat.organisation.name,
        contactEmail: response.retreat.organisation.privacyEmail || response.retreat.contactEmail,
        privacyNoticePath: `/o/${response.retreat.organisation.slug}/privacy?programme=${response.retreat.slug}`,
        publicPagePath: response.retreat.status === 'draft' || response.retreat.status === 'archived' ? null : `/o/${response.retreat.organisation.slug}/r/${response.retreat.slug}`,
      },
      status: response.status,
      submittedAt: response.submittedAt,
      storyTitle: response.storyTitle,
      storyText: response.storyText,
      overallRating: response.overallRating,
      consents: {
        publicText: response.consentPublicText,
        firstName: response.consentFirstName,
        followUp: response.consentFollowUp,
        marketing: response.consentMarketing,
        photoMarketing: response.consentPhotoMarketing,
      },
      photos: response.media.map((m) => ({ id: m.id, caption: m.caption, publishConsent: m.publishConsent, albumConsent: m.albumConsent, published: Boolean(live?.photoIds.includes(m.id)) })),
      publication: { status: response.publicationStatus, url: live && response.publicSlug ? `/stories/${response.publicSlug}` : null },
      organiserMessage: response.organiserMessage,
      album: await albumSummary(response.retreat, response, req.baseUrl + '/' + req.params.token),
      changeRequests: response.changeRequests.map((c) => ({ kind: c.kind, message: c.message, status: c.status, createdAt: c.createdAt })),
      verification: verificationView(ownReview(response)),
    })
  }),
)

/** The receipt's review, in the shape the "Make your review count" steps take (lib/ownVerify.ts). */
const ownReview = (response: Awaited<ReturnType<typeof resolveReceipt>>) => ({
  attendee: response.attendee,
  retreat: { id: response.retreat.id, organisationId: response.retreat.organisationId, title: response.retreat.title },
  response: { id: response.id, submittedAt: response.submittedAt, verifiedAt: response.verifiedAt },
})

/** "Notify me about the next retreat", with the guest's address already known (lib/guestInterest.ts). */
const interestGuest = (response: Awaited<ReturnType<typeof resolveReceipt>>, signedInEmail: string | undefined) => ({
  ...ownReview(response),
  orgName: response.retreat.organisation.name,
  signedIn: Boolean(response.attendee.email && signedInEmail === response.attendee.email),
})
receiptsRouter.get(
  '/:token/interest',
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(await guestInterestView(interestGuest(await resolveReceipt(req.params.token), req.auth?.emailVerified ? req.auth.user.email : undefined)))
  }),
)
receiptsRouter.post(
  '/:token/interest',
  linkCodeLimiter,
  route(async (req, res) => {
    res.json(await guestInterestSignup(interestGuest(await resolveReceipt(req.params.token), req.auth?.emailVerified ? req.auth.user.email : undefined), req.body))
  }),
)

/** Right after sending: confirm the email here (code to the guest's address), as on the thank-you page. */
receiptsRouter.post(
  '/:token/verify/send',
  linkCodeLimiter,
  route(async (req, res) => {
    res.json(await sendOwnCode(ownReview(await resolveReceipt(req.params.token)), req.body))
  }),
)

receiptsRouter.post(
  '/:token/verify/confirm',
  linkCodeLimiter,
  route(async (req, res) => {
    res.json(await confirmOwnCode(ownReview(await resolveReceipt(req.params.token)), req.body, res))
  }),
)

/** Right of access and portability (Arts. 15, 20): the guest's own data as a JSON download. */
receiptsRouter.get(
  '/:token/export',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    const data = await exportGuestData(response.organisationId, response.attendeeId)
    await audit({ organisationId: response.organisationId, actorKind: 'attendee', action: 'guest.exported_own_data', entityType: 'response', entityId: response.id })
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="my-retreat-review-data.json"', 'Cache-Control': 'no-store' })
    res.send(JSON.stringify(data, null, 2))
  }),
)

/** Right to erasure (Art. 17): self-service, immediate, irreversible. */
receiptsRouter.post(
  '/:token/erase',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    parseBody(z.object({ confirm: z.literal('DELETE') }), req.body)
    await eraseAttendee({ organisationId: response.organisationId, attendeeId: response.attendeeId, actorKind: 'attendee', reason: 'guest request' })
    res.json({ ok: true })
  }),
)

// Thank-you photo album, unlocked by having sent the review.
receiptsRouter.get(
  '/:token/album',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    res.set('Cache-Control', 'no-store')
    res.json(
      await albumListing(response.retreat, response, `${req.baseUrl}/${req.params.token}`, {
        orgName: response.retreat.organisation.name,
        retreatPath: `/o/${response.retreat.organisation.slug}/r/${response.retreat.slug}`,
      }),
    )
  }),
)

receiptsRouter.post(
  '/:token/album/photos',
  linkUploadLimiter,
  route(async (req, res, next) => {
    res.locals.receipt = await resolveReceipt(req.params.token)
    next()
  }),
  albumUpload.single('photo'),
  route(async (req, res) => {
    const response = res.locals.receipt as Awaited<ReturnType<typeof resolveReceipt>>
    if (!req.file) throw new HttpError(400, 'Choose a photo to add')
    const asset = await addContribution(response.retreat, response, req.file.buffer, req.body.takenAt)
    res.status(201).json({ id: asset.id })
  }),
)

/** Stop sharing one of my photos in the album (it stays private to me and the organiser). */
receiptsRouter.delete(
  '/:token/album/photos/:photoId',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    await setAlbumSharing(response, uuidParam(req, 'photoId'), false)
    res.status(204).end()
  }),
)

/** The guest's own photo (web copy), for the thumbnails on their private page. */
receiptsRouter.get(
  '/:token/photos/:photoId/image',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    const photo = await prisma.mediaAsset.findFirst({ where: { id: uuidParam(req, 'photoId'), responseId: response.id, kind: 'guest', removedAt: null } })
    if (!photo) throw new HttpError(404, 'Photo not found')
    const bytes = await storage.get(imageKey(photo, req.query.size))
    if (!bytes) throw new HttpError(404, 'Photo not found')
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }).send(bytes)
  }),
)

receiptsRouter.get(
  '/:token/album/:photoId',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    await sendAlbumPhoto(res, response.retreat, response, uuidParam(req, 'photoId'), false, req.query.size)
  }),
)

const changeSchema = z.object({ kind: z.enum(['edit', 'withdraw']), message: text(2000).default('') })

receiptsRouter.post(
  '/:token/change-request',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    const body = parseBody(changeSchema, req.body)
    const open = await prisma.changeRequest.count({ where: { responseId: response.id, status: 'open' } })
    if (open >= 3) throw new HttpError(429, 'You already have requests waiting. The organiser will be in touch.')
    await prisma.changeRequest.create({ data: { organisationId: response.organisationId, responseId: response.id, kind: body.kind, message: body.message } })
    await audit({ organisationId: response.organisationId, actorKind: 'attendee', action: `change_request.${body.kind}`, entityType: 'response', entityId: response.id })
    res.status(201).json({ ok: true })
  }),
)

const withdrawSchema = z.union([
  z.object({ scope: z.enum(['public_text', 'first_name', 'marketing', 'follow_up', 'photo_marketing']) }),
  z.object({ scope: z.literal('photo'), photoId: z.uuid() }),
  z.object({ scope: z.literal('album_photo'), photoId: z.uuid() }),
])

/** Withdrawals are self-service and immediate: no organiser can override a guest's declined choice. */
receiptsRouter.post(
  '/:token/withdraw',
  route(async (req, res) => {
    const response = await resolveReceipt(req.params.token)
    const body = parseBody(withdrawSchema, req.body)
    const event = (scope: string) =>
      prisma.consentEvent.create({
        data: { organisationId: response.organisationId, responseId: response.id, scope, granted: false, wordingVersion: CONSENT_WORDING_VERSION, actor: 'attendee' },
      })

    if (body.scope === 'album_photo') {
      // Stop sharing a photo in the group album; immediate (the album is read on every request).
      await setAlbumSharing(response, body.photoId, false)
    } else if (body.scope === 'photo') {
      const photo = response.media.find((m) => m.id === body.photoId)
      if (!photo) throw new HttpError(404, 'Photo not found')
      await prisma.mediaAsset.update({ where: { id: photo.id }, data: { publishConsent: false } })
      await event(`photo:${photo.id}`)
      await dropPhotoFromLive({ organisationId: response.organisationId, responseId: response.id, photoId: photo.id, reason: 'Guest withdrew photo consent' })
    } else if (body.scope === 'public_text') {
      await prisma.response.update({ where: { id: response.id }, data: { consentPublicText: false } })
      await event('public_text')
      await takeDown({ organisationId: response.organisationId, responseId: response.id, status: 'withdrawn', reason: 'Guest withdrew consent', actorKind: 'attendee' })
    } else if (body.scope === 'first_name') {
      await prisma.response.update({ where: { id: response.id }, data: { consentFirstName: false } })
      await event('first_name')
      await dropNameFromLive(response.organisationId, response.id)
    } else if (body.scope === 'photo_marketing') {
      // No more use of any photo on the website or social media; each comes off the live story now.
      await prisma.response.update({ where: { id: response.id }, data: { consentPhotoMarketing: false } })
      await event('photo_marketing')
      for (const photo of response.media.filter((m) => m.publishConsent)) {
        await prisma.mediaAsset.update({ where: { id: photo.id }, data: { publishConsent: false } })
        await event(`photo:${photo.id}`)
        await dropPhotoFromLive({ organisationId: response.organisationId, responseId: response.id, photoId: photo.id, reason: 'Guest withdrew photo consent' })
      }
    } else if (body.scope === 'marketing') {
      await prisma.response.update({ where: { id: response.id }, data: { consentMarketing: false } })
      await event('marketing')
    } else {
      await prisma.response.update({ where: { id: response.id }, data: { consentFollowUp: false } })
      await event('follow_up')
    }
    await audit({ organisationId: response.organisationId, actorKind: 'attendee', action: `consent.withdrawn.${body.scope}`, entityType: 'response', entityId: response.id })
    res.json({ ok: true })
  }),
)
