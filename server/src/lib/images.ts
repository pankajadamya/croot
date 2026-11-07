import sharp from 'sharp'
import { readCaptureTime, sensibleTime } from '../../../shared/captureTime.js'
import { HttpError } from './http.js'

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif'])
// One decode at a time inside sharp, and no cache of decoded images: memory stays flat on a small server.
sharp.concurrency(1)
sharp.cache(false)

/** A small copy for grids and thumbnails (album grids, photo pickers): about a tenth of the size. */
const THUMB_MAX_EDGE = 640
/** Past this many photos waiting to be processed, new uploads are asked to try again shortly (memory). */
const MAX_WAITING = 8
/** The only copy kept, and the one pages show: sharp on high-density screens, small to load. */
const WEB_MAX_EDGE = 2560
const MAX_INPUT_PIXELS = 60_000_000
/**
 * At most this many photos are decoded at once. A 48-megapixel phone photo needs a few hundred MB
 * while it's being resized, so a burst of uploads queues here (a second or two each) instead of
 * pushing the container past its memory limit.
 */
const MAX_CONCURRENT = 2

let running = 0
const waiting: Array<() => void> = []
export async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  // A free slot is taken at once; otherwise wait for one to be handed over (never more than MAX at once).
  if (running < MAX_CONCURRENT) running++
  else {
    // Each waiting upload holds its file in memory: past a few, ask people to try again in a moment.
    if (waiting.length >= MAX_WAITING) throw new HttpError(503, 'Lots of photos are being added right now. Please try again in a moment.')
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) next() // the slot passes straight to the next photo, so `running` stays the same
    else running--
  }
}

/** How many photos are being processed and how many are waiting (for tests and diagnostics). */
export function imageQueueState() {
  return { running, waiting: waiting.length }
}

export interface ProcessedImage {
  /** When the photo was taken, from its EXIF (else the browser's reading of the original), or null. */
  takenAt: Date | null
  /** The web copy (WebP): the only full copy of the photo that is stored. */
  derivative: Buffer
  /** A small copy (WebP, at most 640px) for grids. */
  thumb: Buffer
  width: number
  height: number
}

/**
 * Validates an upload by decoding it (never by filename or declared type) and makes the one copy
 * that is stored: a web copy (WebP, at most 2560px). The uploaded file itself is never kept.
 * sharp drops EXIF/GPS/camera metadata unless asked to keep it, and `.rotate()` bakes the EXIF
 * orientation in first so the stripped copy still displays the right way up.
 */
export function processImage(input: Buffer, takenAtHint?: unknown): Promise<ProcessedImage> {
  return withImageSlot(async () => {
    const image = await decodeAndResize(input)
    // Read before anything is thrown away; only the time is kept. The browser sends its own reading
    // (takenAtHint) when it had to convert the photo first (HEIC, or too large), which loses EXIF.
    const taken = readCaptureTime(input) ?? sensibleTime(takenAtHint)
    return { ...image, takenAt: taken ? new Date(taken) : null }
  })
}

async function decodeAndResize(input: Buffer): Promise<Omit<ProcessedImage, 'takenAt'>> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch {
    throw new HttpError(415, 'That file is not an image we can read. Please use JPEG, PNG, WebP or HEIC.')
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new HttpError(415, 'Please upload a JPEG, PNG, WebP or HEIC photo.')
  }
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: WEB_MAX_EDGE, height: WEB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  return {
    derivative: data,
    thumb: await makeThumb(data),
    width: info.width,
    height: info.height,
  }
}

/** A small copy of a web copy, for grids. */
export function makeThumb(webCopy: Buffer) {
  return sharp(webCopy).resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer()
}

/** Which stored copy to send: the small one when asked for (?size=thumb) and made, else the web copy. */
export function imageKey(media: { derivativeKey: string; thumbKey: string | null }, size: unknown) {
  return size === 'thumb' && media.thumbKey ? media.thumbKey : media.derivativeKey
}
