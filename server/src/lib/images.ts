import sharp from 'sharp'
import { readCaptureTime, sensibleTime } from '../../../shared/captureTime.js'
import { HttpError } from './http.js'

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif'])
/** The kept copy: full quality, but never larger than 4K on its long edge. */
const STORED_MAX_EDGE = 3840
/** The copy pages show: sharp on high-density screens, much smaller to load. */
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
async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  // A free slot is taken at once; otherwise wait for one to be handed over (never more than MAX at once).
  if (running < MAX_CONCURRENT) running++
  else await new Promise<void>((resolve) => waiting.push(resolve))
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
  original: Buffer
  originalMime: string
  derivative: Buffer
  width: number
  height: number
}

/**
 * Validates an upload by decoding it (never by filename or declared type) and makes two copies:
 *  - the kept copy (stored as the "original"): at most 4K, high quality, so phone photos stay sharp
 *    while a 48-megapixel shot doesn't fill the storage;
 *  - a web copy (WebP, at most 2560px) that pages show.
 * sharp drops EXIF/GPS/camera metadata unless asked to keep it, and `.rotate()` bakes the EXIF
 * orientation in first so the stripped copies still display the right way up.
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
  const base = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
  const fit = (edge: number) => ({ width: edge, height: edge, fit: 'inside' as const, withoutEnlargement: true })
  // Photos keep as JPEG; images with transparency (a PNG graphic, say) as lossless-looking WebP.
  const kept = meta.hasAlpha
    ? { buf: await base().resize(fit(STORED_MAX_EDGE)).webp({ quality: 92 }).toBuffer(), mime: 'image/webp' }
    : { buf: await base().resize(fit(STORED_MAX_EDGE)).jpeg({ quality: 88, mozjpeg: true }).toBuffer(), mime: 'image/jpeg' }
  const { data, info } = await base().resize(fit(WEB_MAX_EDGE)).webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
  return {
    original: kept.buf,
    originalMime: kept.mime,
    derivative: data,
    width: info.width,
    height: info.height,
  }
}
