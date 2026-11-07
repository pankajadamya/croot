import type { Request } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { env } from '../lib/env.js'

/**
 * In-memory limits suit a single instance. When running several instances, swap in a shared store
 * (e.g. rate-limit-redis) here — this is the only place limits are defined.
 */
const base = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
}

export const loginLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 20 })
/** Token validation: generous enough for autosave, tight enough to make guessing pointless. */
export const tokenLimiter = rateLimit({ ...base, windowMs: 5 * 60_000, limit: 300 })
/** Uploads are one request per file; generous enough for an organiser adding a whole album at once. */
export const uploadLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 120 })
/** Anonymous notes: abuse control without any identity, keyed only by IP in memory (never stored). */
/** Hearts on album photos: generous for real use, keyed by IP in memory only. */
export const heartLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 150, message: { error: 'That’s a lot of hearts. Please slow down and try again shortly.' } })
export const anonymousLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 10 })
export const publicFormLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 10 })

/** Requesting email codes: per IP, on top of the per-address hourly cap in loginCodes.ts. */
export const codeLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10 })

// ---------------------------------------------------------------------------------------------
// Guests' private links. Guests at a retreat often share one Wi-Fi (one address), so their limits
// are per link, not per address: one guest's autosaves and photos never block another's. Guessing
// links is limited per address instead, counting only failed lookups.

/** The private link a request is for: the :token param, or the first path segment under the router. */
const linkKey = (req: Request) => `link:${String(req.params?.token ?? req.path.split('/').filter(Boolean)[0] ?? '')}`

/** Everything one guest does on their own link (autosave included): generous per link. */
export const linkLimiter = rateLimit({ ...base, windowMs: 5 * 60_000, limit: 300, keyGenerator: linkKey })
/**
 * Guessing links: per address, counting only links that weren't found (404/410). Other errors don't
 * count, so ordinary mistakes by many guests on one Wi-Fi never add up to a lock-out.
 */
export const linkGuessLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60_000,
  limit: 100,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 404 && res.statusCode !== 410,
})
/** Photo uploads on a guest's own link. */
export const linkUploadLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 60, keyGenerator: linkKey })
/** Email codes from a guest's own link (the thank-you page): per link, on top of per-address caps. */
export const linkCodeLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 12, keyGenerator: linkKey })
/** Joining by a group link: per link (it takes 20 people at most anyway), so a shared Wi-Fi isn't a problem. */
export const groupJoinLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 60, keyGenerator: linkKey })
/** Organisers uploading a whole album: per signed-in user. */
export const organiserUploadLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 300,
  keyGenerator: (req: Request) => (req.auth?.user.id ? `user:${req.auth.user.id}` : ipKeyGenerator(req.ip ?? '')),
})
