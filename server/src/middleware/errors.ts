import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import { HttpError } from '../lib/http.js'
import { redactPath } from '../lib/logger.js'

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details })
  }
  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large.' : 'Upload failed. Please try again.'
    return res.status(413).json({ error: message })
  }
  if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' })
  }
  // Log without request bodies or tokens.
  console.error(`Unhandled error on ${req.method} ${redactPath(req.originalUrl)}:`, err)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
}
