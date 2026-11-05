import { Link } from 'react-router'

export interface AlbumSummary {
  unlocked: boolean
  photoCount: number
  teaser: string[]
  cover: string | null
  note: string | null
  url: string | null
}

/** Before sending: a glimpse of the public album and a direct path after submission. */
export function AlbumTeaser({ album }: { album: AlbumSummary }) {
  return (
    <section className="album-teaser" aria-labelledby="album-teaser-title">
      {album.teaser.length > 0 && (
        <div className="album-teaser-thumbs" aria-hidden="true">
          {album.teaser.map((src) => (
            <img key={src} src={src} alt="" />
          ))}
        </div>
      )}
      <div>
        <h2 id="album-teaser-title">Photos from the retreat</h2>
        <p className="small" style={{ margin: 0 }}>
          {album.photoCount > 0 ? `The public retreat album has ${album.photoCount} photo${album.photoCount === 1 ? '' : 's'}. ` : 'There’s a public retreat album. '}
          After you send your review, we’ll take you there and you can add your own photos too.
        </p>
      </div>
    </section>
  )
}

/** After sending: a card that opens the full-page album in a new tab, so the thank-you page stays open. */
export function AlbumLinkCard({ album, href }: { album: AlbumSummary; href: string }) {
  return (
    <Link to={href} className="album-link-card" target="_blank" rel="noopener">
      {album.cover && <img src={album.cover} alt="" />}
      <span className="album-link-text">
        <span className="album-link-eyebrow">Unlocked: thank you</span>
        <span className="album-link-title">Your retreat photo album</span>
        <span className="album-link-meta">
          {album.photoCount} photo{album.photoCount === 1 ? '' : 's'} · add your own too
        </span>
        <span className="album-btn">
          Open the album <span aria-hidden="true">↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </span>
      </span>
    </Link>
  )
}
