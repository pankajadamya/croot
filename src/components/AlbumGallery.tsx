import { Link } from 'react-router'

export interface AlbumSummary {
  unlocked: boolean
  photoCount: number
  teaser: string[]
  cover: string | null
  note: string | null
  url: string | null
}

/** Before sending: a blurred glimpse of the album and what unlocks it. */
export function AlbumTeaser({ album }: { album: AlbumSummary }) {
  return (
    <section className="album-teaser" aria-labelledby="album-teaser-title">
      {album.teaser.length > 0 && (
        <div className="album-teaser-thumbs" aria-hidden="true">
          {album.teaser.map((src) => (
            <img key={src} src={src} alt="" />
          ))}
          <span className="album-lock">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
        </div>
      )}
      <div>
        <h2 id="album-teaser-title">A photo album is waiting for you</h2>
        <p className="small" style={{ margin: 0 }}>
          Send your review to unlock {album.photoCount > 0 ? `${album.photoCount} photo${album.photoCount === 1 ? '' : 's'} from the retreat` : 'the retreat’s photo album'}
          {album.photoCount > 0 && album.url ? ' and the full album' : ''}. It’s our thank-you for taking part, whatever you choose to share, and you can add your own photos too.
        </p>
      </div>
    </section>
  )
}

/** After sending: a card that opens the full-page album. */
export function AlbumLinkCard({ album, href }: { album: AlbumSummary; href: string }) {
  return (
    <Link to={href} className="album-link-card">
      {album.cover && <img src={album.cover} alt="" />}
      <span className="album-link-text">
        <span className="album-link-eyebrow">Unlocked: thank you</span>
        <span className="album-link-title">Your retreat photo album</span>
        <span className="album-link-meta">
          {album.photoCount} photo{album.photoCount === 1 ? '' : 's'} · add your own too
        </span>
        <span className="album-btn">Open the album →</span>
      </span>
    </Link>
  )
}
