/**
 * Showcase excerpts must be verbatim guest words. The automatic excerpt is the leading sentences of
 * the story up to a length budget; an organiser-chosen excerpt must be an exact substring.
 */
export function autoExcerpt(story: string, maxLength = 240): string {
  const text = story.trim()
  if (text.length <= maxLength) return text
  const sentences = text.match(/[^.!?]+[.!?]+\S*\s*/g) ?? []
  let out = ''
  for (const s of sentences) {
    if ((out + s).trim().length > maxLength) break
    out += s
  }
  if (out.trim()) return out.trim()
  // No sentence boundary within budget: cut on a word boundary. Any ellipsis is added by the UI,
  // so the stored excerpt stays a strict substring of the story.
  const cut = text.slice(0, maxLength)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim()
}

export function isVerbatimExcerpt(story: string, excerpt: string): boolean {
  const e = excerpt.trim()
  return e.length > 0 && story.includes(e)
}
