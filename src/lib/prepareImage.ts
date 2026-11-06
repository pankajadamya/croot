import { EXIF_SCAN_BYTES, readCaptureTime } from '../../shared/captureTime'
/** Matches the server's MAX_UPLOAD_BYTES default. */
export const MAX_UPLOAD_MB = 30
/** Largest edge we keep; matches the server. */
const MAX_EDGE = 3840

/** What file pickers accept: everyday photo formats, including iPhone HEIC. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

export const isHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)
export const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)

/**
 * Gets a photo ready to upload at full quality:
 *  - iPhone HEIC photos (sent as-is by some phones and browsers) become high-quality JPEGs here,
 *    because the server can't read HEIC. The converter loads only when it's needed.
 *  - A file over the size limit is scaled to 4K in the browser first, instead of being refused.
 * Everything else is sent untouched; the server makes the stored 4K copy and the web copy.
 */
export async function prepareImage(file: File): Promise<File> {
  let out = file
  if (isHeic(file)) {
    const { heicTo } = await import('heic-to/csp')
    let blob: Blob
    try {
      blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
    } catch {
      throw new Error('We couldn’t read this HEIC photo. Try saving it as a JPEG first.')
    }
    out = new File([blob], `${file.name.replace(/\.(heic|heif)$/i, '') || 'photo'}.jpg`, { type: 'image/jpeg' })
  }
  if (out.size > MAX_UPLOAD_MB * 1024 * 1024) out = await downscale(out)
  return out
}

async function downscale(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) return file
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

/**
 * When the original photo was taken, read in the browser (an ISO time, or '' when unknown). Sent with
 * the upload as `takenAt`, because converting a HEIC photo or scaling a large one loses its EXIF;
 * the server prefers its own reading when the file still has one. Only the time is read.
 */
export async function captureTimeOf(file: File): Promise<string> {
  try {
    const bytes = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer())
    return readCaptureTime(bytes) ?? ''
  } catch {
    return ''
  }
}
