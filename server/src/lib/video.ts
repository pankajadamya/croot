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

/** Boxes that carry metadata (phone location ©xyz, Apple location keys, XMP), never the picture or sound. */
const METADATA_BOXES = new Set(['udta', 'meta', 'uuid'])
/** Containers we look inside for metadata boxes. Media data (mdat) is never touched. */
const CONTAINERS = new Set(['moov', 'trak'])

/**
 * Removes location and camera metadata from an MP4/MOV file in place, without re-encoding: each
 * metadata box is renamed to a "free" (padding) box and its contents overwritten with zeros. Box
 * sizes stay the same, so every offset in the file stays valid and players ignore the padding.
 * Returns how many boxes were cleared. WebM is left alone (phones don't record location in it).
 */
export async function stripVideoMetadata(path: string): Promise<number> {
  const fh = await open(path, 'r+')
  let cleared = 0
  try {
    const { size: fileSize } = await fh.stat()
    const header = Buffer.alloc(16)
    const walk = async (start: number, end: number, depth: number): Promise<void> => {
      let pos = start
      while (pos + 8 <= end) {
        await fh.read(header, 0, 16, pos)
        let size = header.readUInt32BE(0)
        const type = header.toString('latin1', 4, 8)
        let headerSize = 8
        if (size === 1) {
          size = Number(header.readBigUInt64BE(8))
          headerSize = 16
        } else if (size === 0) {
          size = end - pos // runs to the end of its parent (or the file)
        }
        if (size < headerSize || pos + size > end) return // malformed: stop rather than guess
        if (METADATA_BOXES.has(type)) {
          await fh.write(Buffer.from('free', 'latin1'), 0, 4, pos + 4)
          const zeros = Buffer.alloc(Math.min(size - 8, 1 << 20))
          for (let at = pos + 8; at < pos + size; at += zeros.length) {
            await fh.write(zeros, 0, Math.min(zeros.length, pos + size - at), at)
          }
          cleared++
        } else if (CONTAINERS.has(type) && depth < 3) {
          await walk(pos + headerSize, pos + size, depth + 1)
        }
        pos += size
      }
    }
    await walk(0, fileSize, 0)
  } finally {
    await fh.close()
  }
  return cleared
}
