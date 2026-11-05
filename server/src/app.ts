import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import express, { type Request, type Response } from 'express'
import helmet from 'helmet'
import { env, isProduction } from './lib/env.js'
import { HttpError } from './lib/http.js'
import { accessLog } from './lib/logger.js'
import { poolStats, prisma } from './lib/prisma.js'
import { loadSession, requireCsrf, requireUser } from './middleware/auth.js'
import { errorHandler } from './middleware/errors.js'
import { accountRouter } from './modules/account.js'
import { organiserInvitesRouter } from './modules/organiserInvites.js'
import { adminRouter } from './modules/admin/index.js'
import { authRouter } from './modules/auth.js'
import { invitesRouter, myReviewsRouter } from './modules/invites.js'
import { platformRouter } from './modules/platform.js'
import { mediaRouter, publicRouter } from './modules/public.js'
import { receiptsRouter } from './modules/receipts.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', env.TRUST_PROXY_HOPS)

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      // No referrer ever leaves the app: invite and receipt URLs carry tokens.
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  )
  app.use(compression())
  app.use(accessLog)

  // Health: liveness is process-only; readiness proves the database answers.
  app.get('/health/live', (_req, res) => res.json({ ok: true }))
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ ok: true, db: 'up', pool: poolStats() })
    } catch {
      res.status(503).json({ ok: false, db: 'down' })
    }
  })

  app.use('/media', mediaRouter)

  const api = express.Router()
  api.use(express.json({ limit: '600kb' }))
  // Anonymous notes are mounted before cookies/sessions are parsed, so that path never reads one.
  api.use('/public', publicRouter)
  api.use(cookieParser(), loadSession)
  // Guests: by unique link, or signed in. Editing a sent review needs a verified sign-in (see invites.ts).
  api.use('/invites', invitesRouter)
  api.use('/me/reviews', requireUser, requireCsrf, myReviewsRouter)
  api.use('/responses', receiptsRouter)
  api.use('/auth', authRouter)
  api.use('/account', accountRouter)
  api.use('/organiser-invites', organiserInvitesRouter)
  api.use('/platform', platformRouter)
  api.use('/admin/orgs/:orgSlug', adminRouter)
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')))
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', res.get('Cache-Control') ?? 'no-store')
    next()
  }, api)

  // Production: serve the built SPA. Private routes are marked noindex.
  const dist = resolve('dist')
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/|\/media\/|\/health\/).*/, (req: Request, res: Response) => {
      if (/^\/(invite|response|admin|platform)/.test(req.path)) {
        res.set('X-Robots-Tag', 'noindex, nofollow')
      }
      res.set('Cache-Control', 'no-cache')
      res.sendFile(resolve(dist, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
