/**
 * The small copy of a photo (640px) for grids and thumbnails: about a tenth of the full web copy.
 * The server sends the full copy if a small one hasn't been made yet.
 */
export function thumb(url: string) {
  if (!url) return url
  return `${url}${url.includes('?') ? '&' : '?'}size=thumb`
}
