import { useEffect, useState, type DragEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { del, orgApi, patch, post, put } from '../../../lib/api'
import { MutationError } from '../adminUi'
import type { OrganiserMedia } from '../types'
import { formatDuration } from '../../../lib/format'

/**
 * The album's photos in the order guests see them: drag to reorder, or Move earlier/later (keyboard
 * and touch). One can be the title photo (shown first and largest). Album uploads can be deleted;
 * images from "Your images" are only taken out of the album, and can be added back.
 * Every change saves at once.
 */
export function AlbumGrid({
  orgSlug,
  retreatId,
  coverId,
  media,
  onChanged,
}: {
  orgSlug: string
  retreatId: string
  coverId: string | null
  media: OrganiserMedia[]
  onChanged: () => void
}) {
  const included = media.filter((m) => m.inAlbum)
  const excluded = media.filter((m) => !m.inAlbum)
  const [order, setOrder] = useState(() => included.map((m) => m.id))
  const [dragId, setDragId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Keep the local order in step with the server (new uploads, removals), preserving local moves.
  const includedKey = included.map((m) => m.id).join(',')
  useEffect(() => {
    const ids = included.map((m) => m.id)
    setOrder((prev) => [...prev.filter((id) => ids.includes(id)), ...ids.filter((id) => !prev.includes(id))])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedKey])

  const saveOrder = useMutation({
    mutationFn: (ids: string[]) => put(`${orgApi(orgSlug)}/retreats/${retreatId}/album/order`, { ids }),
    onMutate: () => setStatus('Saving order…'),
    onSuccess: () => setStatus('Order saved'),
    onError: () => setStatus(null),
  })
  const setCover = useMutation({
    mutationFn: (mediaId: string | null) => post(`${orgApi(orgSlug)}/retreats/${retreatId}/album/cover`, { mediaId }),
    onSuccess: onChanged,
  })
  const include = useMutation({
    mutationFn: (v: { id: string; inAlbum: boolean }) => patch(`${orgApi(orgSlug)}/media/${v.id}`, { inAlbum: v.inAlbum }),
    onSuccess: onChanged,
  })
  const remove = useMutation({ mutationFn: (id: string) => del(`${orgApi(orgSlug)}/media/${id}`), onSuccess: onChanged })

  const byId = new Map(media.map((m) => [m.id, m]))
  const ordered = order.map((id) => byId.get(id)).filter((m): m is OrganiserMedia => Boolean(m))

  function commit(next: string[]) {
    setOrder(next)
    saveOrder.mutate(next)
  }
  function move(id: string, delta: number) {
    const i = order.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  function onDrop(e: DragEvent, targetId: string) {
    e.preventDefault()
    if (!dragId || dragId === targetId) return
    const next = order.filter((id) => id !== dragId)
    next.splice(next.indexOf(targetId), 0, dragId)
    setDragId(null)
    commit(next)
  }

  return (
    <div style={{ marginTop: '1.25rem' }}>
      {ordered.length > 0 ? (
        <>
          <div className="spread small" style={{ marginBottom: '0.5rem' }}>
            <span className="muted">Drag photos into the order guests should see them, or use Move earlier / later.</span>
            <span className="muted" aria-live="polite">
              {status}
            </span>
          </div>
          <ol className="album-admin-grid">
            {ordered.map((m, i) => {
              const isCover = m.id === coverId
              const fromImages = m.kind === 'organiser'
              const fromGuest = m.kind === 'guest'
              // Earlier images and guests' photos are only taken out of the album; album uploads are deleted.
              const keep = fromImages || fromGuest
              return (
                <li
                  key={m.id}
                  className={`album-tile ${dragId === m.id ? 'dragging' : ''} ${isCover ? 'is-cover' : ''}`}
                  draggable
                  onDragStart={() => setDragId(m.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, m.id)}
                  aria-label={`Photo ${i + 1} of ${ordered.length}${isCover ? ', title photo' : ''}`}
                >
                  <div className="album-tile-img">
                    <img src={m.previewUrl} alt={m.caption || m.altText || 'Album photo'} loading="lazy" draggable={false} />
                    <span className="album-tile-pos" aria-hidden="true">
                      {i + 1}
                    </span>
                    {isCover && <span className="album-tile-cover">Title photo</span>}
                    {m.isVideo && (
                      <span className="video-badge" aria-label="Video">
                        ▶{m.durationSec ? ` ${formatDuration(m.durationSec)}` : ''}
                      </span>
                    )}
                  </div>
                  <span className="small muted">{fromGuest ? 'Shared by a guest' : fromImages ? 'From your images' : 'Album upload'}</span>
                  <div className="album-tile-actions">
                    {!isCover ? (
                      <button type="button" className="btn ghost small" disabled={setCover.isPending} onClick={() => setCover.mutate(m.id)}>
                        Make title photo
                      </button>
                    ) : (
                      <button type="button" className="btn ghost small" disabled={setCover.isPending} onClick={() => setCover.mutate(null)}>
                        Unset title
                      </button>
                    )}
                    <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => move(m.id, -1)} aria-label={`Move photo ${i + 1} earlier`}>
                      ← Earlier
                    </button>
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={i === ordered.length - 1}
                      onClick={() => move(m.id, 1)}
                      aria-label={`Move photo ${i + 1} later`}
                    >
                      Later →
                    </button>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => {
                        if (keep) include.mutate({ id: m.id, inAlbum: false })
                        else if (window.confirm('Delete this photo from the album?')) remove.mutate(m.id)
                      }}
                    >
                      {keep ? 'Take out of album' : 'Delete'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      ) : (
        <p className="muted">No photos in the album yet.</p>
      )}

      {excluded.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary style={{ cursor: 'pointer' }}>Images not in the album ({excluded.length})</summary>
          <ul className="album-admin-grid" style={{ marginTop: '0.75rem' }}>
            {excluded.map((m) => (
              <li key={m.id} className="album-tile is-excluded">
                <div className="album-tile-img">
                  <img src={m.previewUrl} alt={m.caption || m.altText || 'Image'} loading="lazy" />
                </div>
                <button type="button" className="btn secondary small" disabled={include.isPending} onClick={() => include.mutate({ id: m.id, inAlbum: true })}>
                  Add back
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <MutationError error={saveOrder.error || setCover.error || include.error || remove.error} />
    </div>
  )
}
