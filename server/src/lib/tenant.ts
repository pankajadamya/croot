import { HttpError } from './http.js'
import { prisma } from './prisma.js'

/**
 * Tenant-scoped lookups. Every admin handler fetches parent records through these helpers, which
 * always include the caller's organisation id, so an id from another tenant is simply "not found".
 */
export async function tenantRetreat(orgId: string, retreatId: string) {
  const retreat = await prisma.retreat.findFirst({ where: { id: retreatId, organisationId: orgId } })
  if (!retreat) throw new HttpError(404, 'Retreat not found')
  return retreat
}

export async function tenantAttendee(orgId: string, attendeeId: string) {
  const attendee = await prisma.attendee.findFirst({ where: { id: attendeeId, organisationId: orgId }, include: { retreat: true } })
  if (!attendee) throw new HttpError(404, 'Attendee not found')
  return attendee
}

export async function tenantResponse(orgId: string, responseId: string) {
  const response = await prisma.response.findFirst({ where: { id: responseId, organisationId: orgId } })
  if (!response) throw new HttpError(404, 'Response not found')
  return response
}

export async function tenantMedia(orgId: string, mediaId: string) {
  const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, organisationId: orgId, removedAt: null } })
  if (!media) throw new HttpError(404, 'Image not found')
  return media
}
