import { Router } from 'express'
import { HttpError, route, uuidParam } from '../../lib/http.js'
import { prisma } from '../../lib/prisma.js'
import { BIN_DAYS, binGuest, purgeBinItem, restoreGuest } from '../../lib/recycleBin.js'
import { tenantAttendee, tenantRetreat } from '../../lib/tenant.js'
import { requireOwner, tenantOf } from '../../middleware/auth.js'

/**
 * Deleting reviews: into the recycle bin (lib/recycleBin.ts), restored or deleted for good from there
 * within 30 days. Owners only, like erasing a guest on the Privacy page.
 */
export const recycleBinRouter = Router({ mergeParams: true })

/** Moves a guest and their review, photos and videos into the bin. */
recycleBinRouter.post(
  '/attendees/:attendeeId/bin',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    const id = await binGuest({ organisationId: t.org.id, attendeeId: attendee.id, actorUserId: t.userId })
    res.json({ id, days: BIN_DAYS })
  }),
)

recycleBinRouter.get(
  '/retreats/:retreatId/recycle-bin',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const items = await prisma.recycledGuest.findMany({
      where: { organisationId: t.org.id, retreatId: retreat.id },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, guestName: true, hadReview: true, photoCount: true, deletedAt: true, purgeAfter: true },
    })
    res.json({ items, days: BIN_DAYS })
  }),
)

recycleBinRouter.post(
  '/recycle-bin/:binId/restore',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    res.json(await restoreGuest({ organisationId: t.org.id, binId: uuidParam(req, 'binId'), actorUserId: t.userId }))
  }),
)

/** Deletes a bin entry for good, files included. */
recycleBinRouter.delete(
  '/recycle-bin/:binId',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const item = await prisma.recycledGuest.findFirst({ where: { id: uuidParam(req, 'binId'), organisationId: t.org.id }, select: { id: true, organisationId: true, retreatId: true, objectKeys: true } })
    if (!item) throw new HttpError(404, 'Not in the recycle bin')
    await purgeBinItem(item, { kind: 'user', userId: t.userId })
    res.status(204).end()
  }),
)
