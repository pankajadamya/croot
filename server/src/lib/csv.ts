/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF. Enough for attendee lists. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const text = input.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim()))
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v)
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface AttendeeRow {
  line: number
  name: string
  email: string
  /** Optional stay dates (property reviews), YYYY-MM-DD. */
  stayStart?: string
  stayEnd?: string
  status: 'ok' | 'invalid' | 'duplicate_in_file' | 'already_imported'
  problem?: string
}

/** Accepts `name,email` with or without a header row, in either column order if headed. */
export function parseAttendeeCsv(input: string, existingEmails: Set<string>): AttendeeRow[] {
  const rows = parseCsv(input)
  if (!rows.length) return []
  let nameIdx = 0
  let emailIdx = 1
  let startIdx = -1
  let endIdx = -1
  let start = 0
  const header = rows[0].map((h) => h.trim().toLowerCase())
  if (header.some((h) => h.includes('email'))) {
    emailIdx = header.findIndex((h) => h.includes('email'))
    const n = header.findIndex((h) => h.includes('name'))
    nameIdx = n >= 0 ? n : emailIdx === 0 ? 1 : 0
    startIdx = header.findIndex((h) => /check.?in|stay.?start|arriv/.test(h))
    endIdx = header.findIndex((h) => /check.?out|stay.?end|depart/.test(h))
    start = 1
  }
  const seen = new Set<string>()
  return rows.slice(start).map((r, i): AttendeeRow => {
    const name = (r[nameIdx] ?? '').trim()
    const email = (r[emailIdx] ?? '').trim().toLowerCase()
    const stayStart = startIdx >= 0 ? normaliseDate(r[startIdx]) : undefined
    const stayEnd = endIdx >= 0 ? normaliseDate(r[endIdx]) : undefined
    const line = i + start + 1
    const base = { line, name, email, stayStart: stayStart || undefined, stayEnd: stayEnd || undefined }
    if (!name) return { ...base, status: 'invalid', problem: 'Missing name' }
    if (!EMAIL.test(email)) return { ...base, status: 'invalid', problem: 'Invalid email' }
    if (stayStart === null || stayEnd === null) return { ...base, status: 'invalid', problem: 'Stay dates must look like 2026-10-23 or 23/10/2026' }
    if (stayStart && stayEnd && stayEnd < stayStart) return { ...base, status: 'invalid', problem: 'Check-out is before check-in' }
    if (seen.has(email)) return { ...base, status: 'duplicate_in_file', problem: 'Duplicate in this file' }
    seen.add(email)
    if (existingEmails.has(email)) return { ...base, status: 'already_imported', problem: 'Already on this list' }
    return { ...base, status: 'ok' }
  })
}

/** '' for blank, null for unparseable, else YYYY-MM-DD. Accepts ISO or UK day/month/year. */
function normaliseDate(raw: string | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v)
  if (m) return iso(+m[3], +m[2], +m[1])
  return null
}

function iso(y: number, mo: number, d: number): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}
