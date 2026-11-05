import { Router } from 'express'
import { z } from 'zod'
import { CONSENT_WORDING_VERSION } from '../../../shared/categories.js'
import { audit } from '../lib/audit.js'
import { HttpError, parseBody, route, text } from '../lib/http.js'
import { eraseAttendee, exportGuestData } from '../lib/gdpr.js'
import { prisma } from '../lib/prisma.js'
import { dropNameFromLive, dropPhotoFromLive, livePublication, takeDown } from '../lib/publication.js'
import { hashToken, looksLikeToken } from '../lib/tokens.js'
import { tokenLimiter } from '../middleware/rateLimits.js'

/**
 * The guest's private receipt: view what they sent, see its publication state, withdraw consent
 * (effective immediately) or ask the organiser for an edit. It never exposes anonymous notes.
 */
export const receiptsRouter = Router()
receiptsRouter.use(tokenLimiter)

const INVALID = 'This link is not valid. Please use the most recent link you were given.'

async function resolveReceipt(token: unknown) {
  if (!looksLikeToken(token)) throw new HttpError(404, INVALID)
  const response = await prisma.response.findUnique({
    where: { receiptTokenHash: hashToken(token) },
    include: {
      retreat: { select: { slug: true, title: true, organiserName: true, contactEmail: true, organisation: { select: { name: true, slug: true, privacyEmail: true } } } },
      media: { where: { removedAt: null }, orderBy: { displayOrder: 'asc' } },
      changeRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
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
      },
      status: response.status,
      submittedAt: response.submittedAt,
      storyText: response.storyText,
      overallRating: response.overallRating,
      consents: {
        publicText: response.consentPublicText,
        firstName: response.consentFirstName,
        followUp: response.consentFollowUp,
        marketing: response.consentMarketing,
      },
      photos: response.media.map((m) => ({ id: m.id, caption: m.caption, publishConsent: m.publishConsent, published: Boolean(live?.photoIds.includes(m.id)) })),
      publication: { status: response.publicationStatus, url: live && response.publicSlug ? `/stories/${response.publicSlug}` : null },
      organiserMessage: response.organiserMessage,
      changeRequests: response.changeRequests.map((c) => ({ kind: c.kind, message: c.message, status: c.status, createdAt: c.createdAt })),
    })
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
  z.object({ scope: z.enum(['public_text', 'first_name', 'marketing', 'follow_up']) }),
  z.object({ scope: z.literal('photo'), photoId: z.uuid() }),
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

    if (body.scope === 'photo') {
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
