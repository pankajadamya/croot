import sharp from 'sharp'
import { HttpError } from './http.js'

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif'])
const MAX_DIMENSION = 2000
const MAX_INPUT_PIXELS = 60_000_000

export interface ProcessedImage {
  original: Buffer
  originalMime: string
  derivative: Buffer
  width: number
  height: number
}

/**
 * Validates an upload by decoding it (never by filename or declared type) and produces a web
 * derivative. sharp drops EXIF/GPS/camera metadata unless asked to keep it, and `.rotate()` bakes
 * the EXIF orientation in first so the stripped copy still displays the right way up.
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
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  return {
    original: input,
    originalMime: `image/${meta.format === 'heif' ? 'heic' : meta.format}`,
    derivative: data,
    width: info.width,
    height: info.height,
  }
}
