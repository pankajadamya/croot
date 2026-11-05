const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatDate(value: string | Date | null | undefined) {
  return value ? dateFmt.format(new Date(value)) : ''
}

export function formatDateTime(value: string | Date | null | undefined) {
  return value ? timeFmt.format(new Date(value)) : ''
}

/** "23 October–1 November 2026" */
export function formatRange(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  if (!start && !end) return ''
  if (!start || !end) return formatDate(start ?? end)
  const s = new Date(start)
  const e = new Date(end)
  if (s.getUTCFullYear() === e.getUTCFullYear()) {
    const left = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(s)
    return `${left}–${dateFmt.format(e)}`
  }
  return `${dateFmt.format(s)}–${dateFmt.format(e)}`
}

export function formatShort(value: string | Date) {
  return shortFmt.format(new Date(value))
}

export function toDateInput(value: string | Date | null | undefined) {
  return value ? new Date(value).toISOString().slice(0, 10) : ''
}
