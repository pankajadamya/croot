import { useQuery } from '@tanstack/react-query'
import { get } from '../lib/api'

export interface AlbumSummary {
  unlocked: boolean
  photoCount: number
  teaser: string[]
  note: string | null
  url: string | null
}

interface AlbumListing {
  note: string | null
  url: string | null
  coverId: string | null
  photos: Array<{ id: string; url: string; alt: string; caption: string; width: number; height: number }>
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
          {album.photoCount > 0 && album.url ? ' and the full album' : ''}. It’s our thank-you for taking part, whatever you choose to share.
        </p>
      </div>
    </section>
  )
}

/** After sending: the album itself. Photos open full size in a new tab. */
export function AlbumGallery({ listingUrl }: { listingUrl: string }) {
  const q = useQuery({ queryKey: ['album', listingUrl], queryFn: () => get<AlbumListing>(listingUrl) })
  if (!q.data) return null
  const { note, url, coverId } = q.data
  // The title photo (when set) opens the album, shown large; the rest follow in the organiser's order.
  const cover = coverId && q.data.photos[0]?.id === coverId ? q.data.photos[0] : null
  const photos = cover ? q.data.photos.slice(1) : q.data.photos
  return (
    <section className="card album-gallery" aria-labelledby="album-title">
      <p className="eyebrow" style={{ margin: 0 }}>
        Unlocked: thank you
      </p>
      <h2 id="album-title" style={{ fontSize: '1.4rem' }}>
        Your retreat photo album
      </h2>
      {note && <p style={{ whiteSpace: 'pre-line' }}>{note}</p>}
      {cover && (
        <figure className="album-cover">
          <a href={cover.url} target="_blank" rel="noopener noreferrer">
            <img src={cover.url} alt={cover.alt} width={cover.width} height={cover.height} />
          </a>
          {cover.caption && <figcaption className="small muted">{cover.caption}</figcaption>}
        </figure>
      )}
      {photos.length > 0 && (
        <ul className="album-grid">
          {photos.map((p) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                <img src={p.url} alt={p.alt} width={p.width} height={p.height} loading="lazy" />
              </a>
              {p.caption && <span className="small muted">{p.caption}</span>}
            </li>
          ))}
        </ul>
      )}
      {url && (
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer" style={{ marginTop: '1rem' }}>
          See the full album
        </a>
      )}
    </section>
  )
}
