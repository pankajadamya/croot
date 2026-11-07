import { Router } from 'express'
import { z } from 'zod'
import { albumListing, albumPhotos, sendAlbumPhoto, sendAlbumVideo, sharedRetreat } from '../lib/album.js'
import { heartedBy, setHeart, voterSchema } from '../lib/hearts.js'
import { HttpError, parseBody, route, uuidParam } from '../lib/http.js'
import { heartLimiter, tokenLimiter } from '../middleware/rateLimits.js'

/**
 * The photo album through its unguessable link: /api/albums/:token. Anyone with the link can view it,
 * no sign-in. View and heart only: adding photos is for guests who sent a review.
 * Mounted before cookies are parsed, so it never reads a session.
 */
export const sharedAlbumsRouter = Router()

sharedAlbumsRouter.get(
  '/:token',
  tokenLimiter,
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
    res.json(
      await albumListing(retreat, null, '', {
        publicView: true,
        orgName: retreat.organisation.name,
        retreatPath: `/o/${retreat.organisation.slug}/r/${retreat.slug}`,
      }),
    )
  }),
)

sharedAlbumsRouter.post(
  '/:token/hearts/mine',
  heartLimiter,
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    const { voter, photoIds } = parseBody(z.object({ voter: voterSchema, photoIds: z.array(z.uuid()).max(500) }), req.body)
    const ids = new Set((await albumPhotos(retreat.id)).map((p) => p.id))
    res.set('Cache-Control', 'no-store')
    res.json({ hearted: await heartedBy(voter, photoIds.filter((id) => ids.has(id))) })
  }),
)

sharedAlbumsRouter.post(
  '/:token/:photoId/heart',
  heartLimiter,
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    const photoId = uuidParam(req, 'photoId')
    if (!(await albumPhotos(retreat.id)).some((p) => p.id === photoId)) throw new HttpError(404, 'Photo not found')
    const { voter, on } = parseBody(z.object({ voter: voterSchema, on: z.boolean() }), req.body)
    res.set('Cache-Control', 'no-store')
    res.json({ hearts: await setHeart(photoId, voter, on, req.ip), hearted: on })
  }),
)

sharedAlbumsRouter.get(
  '/:token/:photoId/video',
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    res.set('X-Robots-Tag', 'noindex, nofollow')
    await sendAlbumVideo(req, res, retreat, uuidParam(req, 'photoId'))
  }),
)

sharedAlbumsRouter.get(
  '/:token/:photoId',
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    res.set('X-Robots-Tag', 'noindex, nofollow')
    await sendAlbumPhoto(res, retreat, null, uuidParam(req, 'photoId'), true, req.query.size)
  }),
)
