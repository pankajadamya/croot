import { open } from 'node:fs/promises'
import type { Request, Response } from 'express'
import { HttpError } from './http.js'
import { storage } from './storage.js'

export const VIDEO_TYPES = {
  mp4: { mime: 'video/mp4', ext: 'mp4' },
  mov: { mime: 'video/quicktime', ext: 'mov' },
  webm: { mime: 'video/webm', ext: 'webm' },
} as const

/** Identifies an uploaded video from its first bytes, not its name or claimed type. */
export async function sniffVideo(path: string) {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(16)
    await fh.read(buf, 0, 16, 0)
    if (buf.readUInt32BE(0) === 0x1a45dfa3) return VIDEO_TYPES.webm // EBML (WebM / Matroska)
    if (buf.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buf.toString('ascii', 8, 12)
      return brand === 'qt  ' ? VIDEO_TYPES.mov : VIDEO_TYPES.mp4
    }
  } finally {
    await fh.close()
  }
  throw new HttpError(415, 'Please upload an MP4, MOV or WebM video')
}

/**
 * Sends a stored video, honouring HTTP Range requests so browsers can start quickly and seek
 * (Safari needs this to play at all).
 */
export async function streamVideo(req: Request, res: Response, key: string, mime: string, cacheControl: string) {
  const size = await storage.size(key)
  if (size === null) throw new HttpError(404, 'Video not found')
  res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': mime, 'Cache-Control': cacheControl })

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  let start = 0
  let end = size - 1
  if (range) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2])) // suffix range: the last N bytes
    } else {
      start = Number(range[1] || 0)
      if (range[2] !== '') end = Math.min(Number(range[2]), size - 1)
    }
    if (start > end || start >= size) {
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  res.set('Content-Length', String(end - start + 1))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const body = await storage.stream(key, start, end)
  body.on('error', () => res.destroy())
  body.pipe(res)
}
