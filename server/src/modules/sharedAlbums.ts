import { Router } from 'express'
import { route, uuidParam } from '../lib/http.js'
import { albumListing, sendAlbumPhoto, sharedRetreat } from '../lib/album.js'
import { tokenLimiter } from '../middleware/rateLimits.js'

/**
 * The photo album through its share link: /api/albums/:token. Anyone with the link can view it, no
 * sign-in and no review needed. View only: adding photos stays with guests who sent a review.
 */
export const sharedAlbumsRouter = Router()

sharedAlbumsRouter.get(
  '/:token',
  tokenLimiter,
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
    res.json(await albumListing(retreat, null, `${req.baseUrl}/${req.params.token}`, true))
  }),
)

sharedAlbumsRouter.get(
  '/:token/album/:photoId',
  route(async (req, res) => {
    const retreat = await sharedRetreat(String(req.params.token))
    res.set('X-Robots-Tag', 'noindex, nofollow')
    await sendAlbumPhoto(res, retreat, null, uuidParam(req, 'photoId'), true)
  }),
)
