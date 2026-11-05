import sharp from 'sharp'
import { HttpError } from './http.js'

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif'])
/** The kept copy: full quality, but never larger than 4K on its long edge. */
const STORED_MAX_EDGE = 3840
/** The copy pages show: sharp on high-density screens, much smaller to load. */
const WEB_MAX_EDGE = 2560
const MAX_INPUT_PIXELS = 60_000_000

export interface ProcessedImage {
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
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta: sharp.Metadata
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
