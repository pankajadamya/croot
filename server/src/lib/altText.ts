/**
 * Text alternative for a public image. Alt text is optional for organisers, so fall back to the
 * caption, then to a generic description: screen readers never get an unlabelled image.
 */
export function altFor(m: { altText: string; caption: string }, fallback = 'Retreat photo'): string {
  return m.altText.trim() || m.caption.trim() || fallback
}
