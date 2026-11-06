import { describe, expect, it } from 'vitest'
import { parseExifDate, readCaptureTime, sensibleTime } from './captureTime.js'

describe('capture time from EXIF', () => {
  it('reads the camera clock and applies its time zone when recorded', () => {
    expect(parseExifDate('2026:10:24 05:52:28', '+05:30')).toBe('2026-10-24T00:22:28.000Z')
    expect(parseExifDate('2026:10:24 05:52:28', '-04:00')).toBe('2026-10-24T09:52:28.000Z')
    // No offset: the clock time as it was on the camera.
    expect(parseExifDate('2026:10:24 05:52:28')).toBe('2026-10-24T05:52:28.000Z')
  })

  it('refuses nonsense: blank, the 0000 placeholder, before 1990 or in the future', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull()
    expect(parseExifDate('1980:01:01 00:00:00')).toBeNull()
    expect(sensibleTime('2099-01-01T00:00:00Z')).toBeNull()
    expect(sensibleTime('not a date')).toBeNull()
    expect(sensibleTime(42)).toBeNull()
  })

  it('finds nothing in a file without EXIF', () => {
    expect(readCaptureTime(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })
})
