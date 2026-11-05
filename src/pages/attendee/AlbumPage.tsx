import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router'
import { api, ApiError, del, get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { LinkUnavailable, Loading } from '../../components/States'
import { HeartButton, useHearts } from '../../components/Hearts'
import { formatDuration } from '../../lib/format'

interface AlbumPhoto {
  id: string
  url: string
  alt: string
  caption: string
  width: number
  height: number
  sharedByGuest: boolean
  mine: boolean
  hearts: number
  /** For videos: where to stream it from; url is then its poster. */
  video: string | null
  duration: number | null
}
interface AlbumListing {
  pageUrl: string
  title: string
  note: string | null
  url: string | null
  coverId: string | null
  canContribute: boolean
  photos: AlbumPhoto[]
}

/**
 * The group photo album, full page. Guests who sent a review reach it through their own private link or
 * sign-in (and can add photos); anyone else through the album's share link, view only, no sign-in.
 * `base` is the API base: /api/invites/:token, /api/responses/:token, /api/me/reviews/:id or /api/albums/:token.
 */
function AlbumView({ base, listPath = `${base}/album`, backTo, backLabel }: { base: string; listPath?: string; backTo?: string; backLabel?: string }) {
  const qc = useQueryClient()
  const key = ['album-page', base]
  const q = useQuery({ queryKey: key, queryFn: () => get<AlbumListing>(listPath), retry: false })
  // The open photo lives in the address (?photo=<id>), so a refresh or a shared link opens the same one.
  const [params, setParams] = useSearchParams()
  const openId = params.get('photo')
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  const hearts = useHearts(q.data?.pageUrl ?? '', q.data?.photos ?? [])

  useEffect(() => {
    if (q.data) document.title = `Photo album · ${q.data.title}`
  }, [q.data])

  if (q.isLoading) return <Loading />
  if (q.error) {
    const locked = q.error instanceof ApiError && q.error.status === 403
    return <LinkUnavailable message={locked ? 'The album unlocks once you’ve sent your review.' : (q.error as Error).message} />
  }
  const album = q.data!
  const photos = album.photos
  const found = openId ? photos.findIndex((p) => p.id === openId) : -1
  const open = found >= 0 ? found : null
  const setOpen = (i: number | null) => {
    const closing = i === null ? openId : null
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (i === null) next.delete('photo')
        else next.set('photo', photos[i].id)
        return next
      },
      { replace: true },
    )
    // Back on the grid, keep the photo just viewed in sight.
    if (closing) requestAnimationFrame(() => document.querySelector(`[data-photo="${closing}"]`)?.scrollIntoView({ block: 'center' }))
  }
  const cover = photos[0]

  async function contribute(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
    if (!images.length) return
    setError(null)
    setUploading({ done: 0, total: images.length })
    const failed: string[] = []
    for (const [i, file] of images.entries()) {
      const fd = new FormData()
      fd.append('photo', file)
      try {
        await api('POST', `${base}/album/photos`, fd)
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof ApiError ? e.message : 'upload failed'}`)
      }
      setUploading({ done: i + 1, total: images.length })
      void qc.invalidateQueries({ queryKey: key })
    }
    setUploading(null)
    if (failed.length) setError(failed.join(' · '))
  }

  async function share() {
    const url = new URL(album.pageUrl, window.location.origin).toString()
    const data = { title: `Photo album · ${album.title}`, url }
    try {
      if (navigator.share && navigator.canShare?.(data)) {
        await navigator.share(data)
        return
      }
      await navigator.clipboard.writeText(url)
      setShared('Link copied. Anyone with it can view the album, no sign-in needed.')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      window.prompt('Copy this link to share the album:', url)
    }
  }

  async function stopSharing(p: AlbumPhoto) {
    if (!window.confirm('Stop sharing this photo in the album? It stays in your review, private to you and the organiser.')) return
    await del(`${base}/album/photos/${p.id}`)
    setOpen(null)
    void qc.invalidateQueries({ queryKey: key })
  }

  return (
    <div className="album-page">
      <header className="album-page-bar">
        {backTo ? (
          <Link to={backTo} className="album-back">
            ← {backLabel}
          </Link>
        ) : (
          <span />
        )}
        <Link to="/" className="brand" aria-label="Croot home page">
          <img className="brand-logo" src="/croot-logo-light.svg" alt="Croot" />
        </Link>
      </header>

      <section className="album-hero" aria-label={album.title}>
        {cover && <img className="album-hero-img" src={cover.url} alt={cover.alt} />}
        <div className="album-hero-text">
          <p className="album-hero-eyebrow">Photo album · {photos.length} photo{photos.length === 1 ? '' : 's'}</p>
          <h1>{album.title}</h1>
          {album.note && <p className="album-hero-note">{album.note}</p>}
          <div className="row" style={{ marginTop: '1.25rem' }}>
            {photos.length > 0 && (
              <button type="button" className="album-btn" onClick={() => setOpen(0)}>
                View photos
              </button>
            )}
            <button type="button" className="album-btn ghost" onClick={() => void share()}>
              Share album
            </button>
            {album.url && (
              <a className="album-btn ghost" href={album.url} target="_blank" rel="noopener noreferrer">
                Full-resolution album ↗
              </a>
            )}
          </div>
          {shared && (
            <p className="album-hero-note" role="status" style={{ marginTop: '0.75rem' }}>
              {shared}
            </p>
          )}
        </div>
      </section>

      <main className="album-body">
        {album.canContribute && (
          <div className="album-contribute">
            <div>
              <h2>Add your photos</h2>
              <p>Share your own moments. Photos you add here are public: anyone can see them in this album, which is linked from the retreat’s public page. Only add photos the people in them would be happy to share publicly.</p>
            </div>
            <label className="album-btn" htmlFor="album-add">
              {uploading ? `Adding ${Math.min(uploading.done + 1, uploading.total)} of ${uploading.total}…` : 'Add photos'}
            </label>
            <input
              id="album-add"
              className="sr-only"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              disabled={Boolean(uploading)}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void contribute(files)
              }}
            />
          </div>
        )}
        {error && (
          <p className="album-error" role="alert">
            {error}
          </p>
        )}
        {photos.length === 0 ? (
          <p className="album-empty">No photos yet. Be the first to add one.</p>
        ) : (
          <ul className="album-mosaic">
            {photos.map((p, i) => (
              <li key={p.id} data-photo={p.id} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                <button type="button" onClick={() => setOpen(i)} aria-label={`${p.video ? 'Play video' : 'Open photo'} ${i + 1} of ${photos.length}${p.caption ? `: ${p.caption}` : ''}`}>
                  <img src={p.url} alt={p.alt} loading={i < 6 ? 'eager' : 'lazy'} />
                  {p.video && (
                    <span className="video-badge on-photo" aria-hidden="true">
                      ▶{p.duration ? ` ${formatDuration(p.duration)}` : ''}
                    </span>
                  )}
                </button>
                {(p.sharedByGuest || p.caption) && (
                  <span className="album-tag">{p.mine ? 'Shared by you' : p.sharedByGuest ? 'Shared by a guest' : p.caption}</span>
                )}
                {hearts.enabled && <HeartButton on={hearts.hearted(p.id)} count={hearts.count(p)} onToggle={() => void hearts.toggle(p)} />}
              </li>
            ))}
          </ul>
        )}
        {hearts.message && (
          <p className="album-error" role="alert">
            {hearts.message}
          </p>
        )}
      </main>

      {open !== null && photos[open] && (
        <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onStopSharing={stopSharing} hearts={hearts} />
      )}
    </div>
  )
}

/** Full-screen viewer: swipe, arrow keys or the edge buttons; Esc closes. */
function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  onStopSharing,
  hearts,
}: {
  photos: AlbumPhoto[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onStopSharing: (p: AlbumPhoto) => void
  hearts: ReturnType<typeof useHearts>
}) {
  const p = photos[index]
  const startX = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const go = useCallback((d: number) => onIndex((index + d + photos.length) % photos.length), [index, onIndex, photos.length])

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [go, onClose])

  function onPointerDown(e: PointerEvent) {
    // Dragging along a video's own controls (seek bar, volume) must not change the photo.
    startX.current = (e.target as HTMLElement).tagName === 'VIDEO' ? null : e.clientX
  }
  function onPointerUp(e: PointerEvent) {
    if (startX.current === null) return
    const dx = e.clientX - startX.current
    startX.current = null
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${photos.length}`}>
      <div className="lightbox-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        {p.video ? (
          // Plays straight away when opened, with the browser's own controls (sound off until the viewer turns it on).
          <video key={p.id} src={p.video} poster={p.url} controls autoPlay playsInline muted preload="metadata" aria-label={p.alt} />
        ) : (
          <img key={p.id} src={p.url} alt={p.alt} draggable={false} />
        )}
      </div>
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {photos.length > 1 && (
        <>
          <button type="button" className="lightbox-edge left" onClick={() => go(-1)} aria-label="Previous photo">
            ‹
          </button>
          <button type="button" className="lightbox-edge right" onClick={() => go(1)} aria-label="Next photo">
            ›
          </button>
        </>
      )}
      <div className="lightbox-caption">
        <span>
          {p.caption || (p.sharedByGuest ? (p.mine ? 'Shared by you' : 'Shared by a guest') : '')}
        </span>
        <span className="lightbox-count">
          {index + 1} / {photos.length}
        </span>
        {hearts.enabled && <HeartButton variant="bar" on={hearts.hearted(p.id)} count={hearts.count(p)} onToggle={() => void hearts.toggle(p)} />}
        {p.mine && (
          <button type="button" className="album-btn ghost small" onClick={() => onStopSharing(p)}>
            Stop sharing
          </button>
        )}
      </div>
    </div>
  )
}

/** /invite/:token/album: from the guest's unique link. */
export function InviteAlbumPage() {
  const { token = '' } = useParams()
  return <AlbumView base={`/api/invites/${token}`} backTo={`/invite/${token}`} backLabel="Back to my review" />
}

/** /response/:token/album: from the guest's private response page. */
export function ReceiptAlbumPage() {
  const { token = '' } = useParams()
  return <AlbumView base={`/api/responses/${token}`} backTo={`/response/${token}`} backLabel="Back to my response" />
}

/** /my-reviews/:attendeeId/album: signed in. */
export function SignedInAlbumPage() {
  const { attendeeId = '' } = useParams()
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />
  return <AlbumView base={`/api/me/reviews/${attendeeId}`} backTo={`/my-reviews/${attendeeId}`} backLabel="Back to my review" />
}

/** /album/:token: the album's share link. Anyone with it can view, no sign-in. */
/** /o/:orgSlug/r/:retreatSlug/album: the album's public page. Anyone can view it, no sign-in. */
export function PublicAlbumPage() {
  const { orgSlug = '', retreatSlug = '' } = useParams()
  const api = `/api/public/orgs/${orgSlug}/retreats/${retreatSlug}/album`
  return <AlbumView base={api} listPath={api} backTo={`/o/${orgSlug}/r/${retreatSlug}`} backLabel="Back to the retreat" />
}

export default InviteAlbumPage
