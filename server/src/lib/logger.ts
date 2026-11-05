import type { NextFunction, Request, Response } from 'express'

/**
 * Paths that carry bearer tokens. Their token segment is replaced before anything is logged, so
 * routine logs never contain a working invite, receipt or setup link.
 */
const TOKEN_PATHS = /\/(invites|invite|responses|response|setup|interest)\/[^/?#]+/g

export function redactPath(path: string): string {
  return path.replace(TOKEN_PATHS, '/$1/[redacted]').replace(/\?.*$/, '')
}

/** Minimal access log: method, redacted path, status, duration. No IPs, referrers or user agents. */
export function accessLog(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    if (req.path.startsWith('/health')) return
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    console.log(`${req.method} ${redactPath(req.originalUrl)} ${res.statusCode} ${ms.toFixed(0)}ms`)
  })
  next()
}
