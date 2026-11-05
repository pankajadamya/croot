import { rateLimit } from 'express-rate-limit'
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
export const anonymousLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 10 })
export const publicFormLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 10 })

/** Requesting email codes: per IP, on top of the per-address hourly cap in loginCodes.ts. */
export const codeLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10 })
