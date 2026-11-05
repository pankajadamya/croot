import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'

export class HttpError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what)

/** Express 5 forwards rejected promises, but this keeps handler signatures uniform and typed. */
export function route(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new HttpError(400, 'Some fields need attention', z.flattenError(result.error).fieldErrors)
  }
  return result.data
}

export function param(req: Request, name: string): string {
  const v = req.params[name]
  if (typeof v !== 'string' || !v) throw new HttpError(400, `${name} is required`)
  return v
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function uuidParam(req: Request, name: string): string {
  const v = param(req, name)
  if (!UUID.test(v)) throw new HttpError(404, 'Not found')
  return v
}

/** Strips control characters (keeps newlines/tabs) and trims. */
export function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
}

export const text = (max: number) => z.string().max(max).transform(cleanText)
