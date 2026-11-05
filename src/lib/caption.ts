/** Keep short photo overlays readable without changing the saved caption. */
export function shortCaption(caption: string, max = 120): string {
  const singleLine = caption.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= max) return singleLine
  const prefix = singleLine.slice(0, max - 1)
  const lastSpace = prefix.lastIndexOf(' ')
  return `${(lastSpace > max / 2 ? prefix.slice(0, lastSpace) : prefix).trimEnd()}…`
}
