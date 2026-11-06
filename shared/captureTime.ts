/**
 * When a photo was taken, read from its EXIF block: DateTimeOriginal (falling back to DateTime) and,
 * when the camera recorded it, the time-zone offset. Nothing else is read or kept: not the location,
 * the camera or the phone.
 *
 * Works on JPEG and on HEIC/HEIF (whose EXIF block is the same TIFF structure, stored in the file's
 * first few hundred kilobytes), so the browser can read it from an iPhone photo before converting it,
 * and the server from whatever arrives. Used by both (src/lib/prepareImage.ts, server/src/lib/images.ts).
 */

/** How far into a file to look for the EXIF block. */
export const EXIF_SCAN_BYTES = 512 * 1024

const TAG_DATETIME = 0x0132
const TAG_EXIF_IFD = 0x8769
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_OFFSET_TIME_ORIGINAL = 0x9011

/** Finds the TIFF header that follows "Exif\0\0", or null. */
function findTiff(bytes: Uint8Array): number | null {
  const end = Math.min(bytes.length, EXIF_SCAN_BYTES) - 10
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x66 && bytes[i + 4] === 0 && bytes[i + 5] === 0) {
      const t = i + 6
      const ii = bytes[t] === 0x49 && bytes[t + 1] === 0x49 && bytes[t + 2] === 0x2a && bytes[t + 3] === 0
      const mm = bytes[t] === 0x4d && bytes[t + 1] === 0x4d && bytes[t + 2] === 0 && bytes[t + 3] === 0x2a
      if (ii || mm) return t
    }
  }
  return null
}

/** The EXIF capture time as an ISO string (UTC), or null when there isn't a usable one. */
export function readCaptureTime(bytes: Uint8Array): string | null {
  const tiff = findTiff(bytes)
  if (tiff === null) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const little = bytes[tiff] === 0x49
  const u16 = (at: number) => view.getUint16(at, little)
  const u32 = (at: number) => view.getUint32(at, little)
  const inRange = (at: number, len: number) => at >= 0 && at + len <= bytes.length

  /** A directory's ASCII entries we care about, plus the EXIF sub-directory's offset. */
  function readIfd(offset: number): Map<number, string | number> {
    const out = new Map<number, string | number>()
    const at = tiff! + offset
    if (!inRange(at, 2)) return out
    const count = u16(at)
    if (count > 500) return out
    for (let n = 0; n < count; n++) {
      const entry = at + 2 + n * 12
      if (!inRange(entry, 12)) break
      const tag = u16(entry)
      const type = u16(entry + 2)
      const length = u32(entry + 4)
      if (tag === TAG_EXIF_IFD && (type === 4 || type === 13)) out.set(tag, u32(entry + 8))
      else if (type === 2 && length > 0 && length < 64 && (tag === TAG_DATETIME || tag === TAG_DATETIME_ORIGINAL || tag === TAG_OFFSET_TIME_ORIGINAL)) {
        const start = length <= 4 ? entry + 8 : tiff! + u32(entry + 8)
        if (!inRange(start, length)) continue
        let text = ''
        for (let k = 0; k < length && bytes[start + k] !== 0; k++) text += String.fromCharCode(bytes[start + k])
        out.set(tag, text)
      }
    }
    return out
  }

  try {
    const first = readIfd(u32(tiff + 4))
    const exifOffset = first.get(TAG_EXIF_IFD)
    const exif = typeof exifOffset === 'number' ? readIfd(exifOffset) : new Map<number, string | number>()
    const raw = (exif.get(TAG_DATETIME_ORIGINAL) ?? first.get(TAG_DATETIME)) as string | undefined
    const offset = exif.get(TAG_OFFSET_TIME_ORIGINAL) as string | undefined
    return raw ? parseExifDate(raw, offset) : null
  } catch {
    return null
  }
}

/**
 * "2026:10:24 06:12:45" (+ "+05:30") → ISO UTC. Without an offset the clock time is kept as if it
 * were UTC: photos from one trip still sort correctly, and the time shown is the one on the camera.
 */
export function parseExifDate(raw: string, offset?: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  let ms = Date.UTC(y, mo - 1, d, h, mi, s)
  const o = offset && /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim())
  if (o) ms -= (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])) * 60_000
  return sensibleTime(new Date(ms).toISOString())
}

/** A capture time we're prepared to store: a real date, not before 1990 and not in the future. */
export function sensibleTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const t = Date.parse(value)
  if (!Number.isFinite(t) || t < Date.UTC(1990, 0, 1) || t > Date.now() + 36 * 3600_000) return null
  return new Date(t).toISOString()
}
