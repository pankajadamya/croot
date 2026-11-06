import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SaveIndicator } from '../../../components/SaveIndicator'
import { del, orgApi, patch, post, put } from '../../../lib/api'
import { MutationError } from '../adminUi'
import type { OrganiserMedia } from '../types'
import { formatDateTime, formatDuration } from '../../../lib/format'
import { useConfirm } from '../../../components/ConfirmDialog'

/**
 * Album photos in the order guests (and the memory film) see them.
 *  - Drag to reorder: smooth with a mouse, a finger (press and hold a moment) or the keyboard
 *    (focus a tile's handle, Space to lift, arrows to move, Space to drop). Earlier / Later stay too.
 *  - "Photos only" shows just the pictures, small, so long albums are easy to arrange.
 *  - "Sort by time taken" orders them by when they were taken; photos without a time go last.
 *  - One title photo, chosen from the toolbar.
 *  - "Delete all" empties the album: uploads are deleted, other images are only taken out of it.
 * Every change saves at once.
 */
export function AlbumGrid({
  orgSlug,
  retreatId,
  coverId,
  media,
  duplicates = {},
  onChanged,
}: {
  orgSlug: string
  retreatId: string
  coverId: string | null
  media: OrganiserMedia[]
  /** Later copies of a picture already in the album → the first copy's id. Guests see it once. */
  duplicates?: Record<string, string>
  onChanged: () => void
}) {
  const confirm = useConfirm()
  const included = media.filter((m) => m.inAlbum)
  const excluded = media.filter((m) => !m.inAlbum)
  const [order, setOrder] = useState(() => included.map((m) => m.id))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [compact, setCompact] = useState(false)
  const [choosingTitle, setChoosingTitle] = useState(false)

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
    onSuccess: () => {
      setChoosingTitle(false)
      onChanged()
    },
  })
  const include = useMutation({
    mutationFn: (v: { id: string; inAlbum: boolean }) => patch(`${orgApi(orgSlug)}/media/${v.id}`, { inAlbum: v.inAlbum }),
    onSuccess: onChanged,
  })
  const remove = useMutation({ mutationFn: (id: string) => del(`${orgApi(orgSlug)}/media/${id}`), onSuccess: onChanged })
  const clearAll = useMutation({
    mutationFn: () => post<{ deleted: number; takenOut: number }>(`${orgApi(orgSlug)}/retreats/${retreatId}/album/clear`),
    onSuccess: (r) => {
      setStatus(`Album emptied: ${r.deleted} deleted, ${r.takenOut} taken out`)
      onChanged()
    },
  })
  const removeDuplicates = useMutation({
    mutationFn: () => post<{ removed: number }>(`${orgApi(orgSlug)}/retreats/${retreatId}/album/remove-duplicates`),
    onSuccess: (r) => {
      setStatus(`Removed ${r.removed} duplicate${r.removed === 1 ? '' : 's'}`)
      onChanged()
    },
  })
  const duplicateCount = Object.keys(duplicates).length
  // Approving a guest's photo publishes it straight away: in the album, and with their story if they allowed that.
  const moderate = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected' }) => post(`${orgApi(orgSlug)}/media/${v.id}/moderate`, { status: v.status }),
    onSuccess: onChanged,
  })

  const byId = new Map(media.map((m) => [m.id, m]))
  const ordered = order.map((id) => byId.get(id)).filter((m): m is OrganiserMedia => Boolean(m))
  const active = activeId ? byId.get(activeId) : undefined

  function commit(next: string[]) {
    setOrder(next)
    saveOrder.mutate(next)
  }
  function move(id: string, delta: number) {
    const i = order.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    commit(arrayMove(order, i, j))
  }

  const sensors = useSensors(
    // A small movement before a drag starts, so clicks on buttons and inputs still work.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: press and hold briefly, so the page still scrolls with a normal swipe.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    if (!e.over || e.active.id === e.over.id) return
    commit(arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id))))
  }

  async function sortByTime() {
    const withTime = ordered.filter((m) => m.takenAt).length
    if (!withTime) {
      setStatus('None of these photos says when it was taken')
      return
    }
    // Stable: photos taken at the same moment, or without a time, keep their current order.
    const next = [...ordered]
      .map((m, i) => ({ m, i, t: m.takenAt ? Date.parse(m.takenAt) : Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.t - b.t || a.i - b.i)
      .map((x) => x.m.id)
    commit(next)
    const without = ordered.length - withTime
    setStatus(`Sorted by time taken${without ? `; ${without} without a time are at the end` : ''}`)
  }

  async function confirmClearAll() {
    const uploads = ordered.filter((m) => m.kind === 'album').length
    const others = ordered.length - uploads
    const ok = await confirm({
      title: 'Delete all photos from the album?',
      message: [
        uploads ? `${uploads} album upload${uploads === 1 ? '' : 's'} will be deleted for good.` : '',
        others ? `${others} other photo${others === 1 ? '' : 's'} (from your images or shared by guests) will be taken out of the album but kept.` : '',
        'The title photo is cleared.',
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: 'Delete all',
      danger: true,
    })
    if (ok) clearAll.mutate()
  }

  const cover = coverId ? byId.get(coverId) : undefined
  const canBeTitle = (m: OrganiserMedia) => m.kind !== 'guest' && m.approved

  return (
    <div style={{ marginTop: '1.25rem' }}>
      {ordered.length > 0 ? (
        <>
          <div className="album-toolbar" role="toolbar" aria-label="Album tools">
            <div className="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={!compact} className={!compact ? 'on' : ''} onClick={() => setCompact(false)}>
                Details
              </button>
              <button type="button" aria-pressed={compact} className={compact ? 'on' : ''} onClick={() => setCompact(true)}>
                Photos only
              </button>
            </div>
            <button type="button" className="btn secondary small" onClick={() => void sortByTime()} disabled={saveOrder.isPending}>
              Sort by time taken
            </button>
            <button type="button" className={`btn small ${choosingTitle ? '' : 'secondary'}`} aria-pressed={choosingTitle} onClick={() => setChoosingTitle((x) => !x)}>
              {choosingTitle ? 'Cancel choosing' : cover ? 'Change title photo' : 'Choose title photo'}
            </button>
            {cover && !choosingTitle && (
              <button type="button" className="btn ghost small" disabled={setCover.isPending} onClick={() => setCover.mutate(null)}>
                Remove title photo
              </button>
            )}
            {duplicateCount > 0 && (
              <button
                type="button"
                className="btn secondary small"
                disabled={removeDuplicates.isPending}
                onClick={() =>
                  void confirm({
                    title: `Remove ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}?`,
                    message: 'The first copy of each picture stays. Extra album uploads are deleted; extra copies from your images or from guests are only taken out of the album.',
                    confirmLabel: 'Remove duplicates',
                  }).then((ok) => ok && removeDuplicates.mutate())
                }
              >
                Remove {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'}
              </button>
            )}
            <button type="button" className="btn ghost small danger-text" disabled={clearAll.isPending} onClick={() => void confirmClearAll()}>
              Delete all
            </button>
          </div>
          <p className="small muted album-toolbar-note" aria-live="polite">
            {choosingTitle
              ? 'Click the photo to show first and largest. Guests’ photos can’t be the title photo.'
              : status ?? (compact ? 'Drag photos into order. On a phone, press and hold a photo, then move it.' : 'Drag a photo to move it (on a phone, press and hold first), or use its arrows. You can also drop new photos anywhere here.')}
          </p>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <SortableContext items={order} strategy={rectSortingStrategy}>
              <ol className={`album-admin-grid ${compact ? 'compact' : ''} ${choosingTitle ? 'choosing' : ''}`}>
                {ordered.map((m, i) => {
                  const isCover = m.id === coverId
                  const fromImages = m.kind === 'organiser'
                  const fromGuest = m.kind === 'guest'
                  const keep = fromImages || fromGuest
                  const label = `Photo ${i + 1} of ${ordered.length}${isCover ? ', title photo' : ''}${m.caption ? `: ${m.caption}` : ''}`
                  if (choosingTitle) {
                    return (
                      <li key={m.id} className={`album-tile ${isCover ? 'is-cover' : ''} ${compact ? 'compact' : ''}`}>
                        <button
                          type="button"
                          className="album-tile-pick"
                          disabled={!canBeTitle(m) || setCover.isPending}
                          onClick={() => setCover.mutate(m.id)}
                          aria-label={`Make photo ${i + 1} the title photo`}
                        >
                          <TileImage m={m} position={i + 1} isCover={isCover} />
                        </button>
                      </li>
                    )
                  }
                  return (
                    <SortableTile key={m.id} id={m.id} compact={compact} label={label} isCover={isCover}>
                      {(handle, dragArea) => (
                        <>
                          {compact ? (
                            <div {...handle} className="album-tile-handle-area" aria-label={`${label}. Press Space to move it.`}>
                              <TileImage m={m} position={i + 1} isCover={isCover} />
                            </div>
                          ) : (
                            <>
                              {/* The photo itself drags (mouse or finger); the handle is for the keyboard. */}
                              <div className="album-tile-img-wrap" {...dragArea}>
                                <TileImage m={m} position={i + 1} isCover={isCover} />
                                <button type="button" className="album-drag-handle" {...handle} aria-label={`Move ${label}. Press Space to lift, arrows to move.`}>
                                  <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <circle cx="5.5" cy="4" r="1.3" /><circle cx="10.5" cy="4" r="1.3" />
                                    <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
                                    <circle cx="5.5" cy="12" r="1.3" /><circle cx="10.5" cy="12" r="1.3" />
                                  </svg>
                                </button>
                              </div>
                              <span className="small muted">
                                {fromGuest ? 'Shared by a guest' : fromImages ? 'From your images' : 'Album upload'}
                                {m.takenAt ? ` · ${formatDateTime(m.takenAt)}` : ''}
                              </span>
                              {!fromGuest && <AlbumCaption orgSlug={orgSlug} media={m} onChanged={onChanged} />}
                              {fromGuest && !m.approved && (
                                <div className="album-tile-approve">
                                  <span className="badge warn">Awaiting approval · hidden from album</span>
                                  <button type="button" className="btn small approve-action" disabled={moderate.isPending} onClick={() => moderate.mutate({ id: m.id, status: 'approved' })}>
                                    Approve
                                  </button>
                                </div>
                              )}
                              {fromGuest && m.approved && <span className="badge ok">In the album</span>}
                              {duplicates[m.id] && (
                                <span className="badge warn" title="The same picture is already in the album. Guests and the memory film see it once; you can delete this copy.">
                                  Duplicate of #{order.indexOf(duplicates[m.id]) + 1} · shown once
                                </span>
                              )}
                              <div className="album-tile-actions">
                                <span className="album-tile-move">
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    disabled={i === 0}
                                    onClick={() => move(m.id, -1)}
                                    aria-label={`Move photo ${i + 1} earlier`}
                                    data-tip="Move earlier"
                                  >
                                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    disabled={i === ordered.length - 1}
                                    onClick={() => move(m.id, 1)}
                                    aria-label={`Move photo ${i + 1} later`}
                                    data-tip="Move later"
                                  >
                                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </button>
                                </span>
                                <button
                                  type="button"
                                  className="btn ghost small"
                                  onClick={() => {
                                    if (keep) include.mutate({ id: m.id, inAlbum: false })
                                    else
                                      void confirm({
                                        title: `Delete this ${m.isVideo ? 'video' : 'photo'} from the album?`,
                                        message: 'It’s deleted for good.',
                                        confirmLabel: 'Delete',
                                        danger: true,
                                      }).then((ok) => ok && remove.mutate(m.id))
                                  }}
                                >
                                  {keep ? 'Take out of album' : 'Delete'}
                                </button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </SortableTile>
                  )
                })}
              </ol>
            </SortableContext>
            {/* The photo being dragged follows the pointer smoothly, above everything. */}
            <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
              {active ? (
                <div className={`album-tile overlay ${compact ? 'compact' : ''}`}>
                  <TileImage m={active} position={order.indexOf(active.id) + 1} isCover={active.id === coverId} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
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
      <MutationError error={saveOrder.error || setCover.error || include.error || remove.error || moderate.error || clearAll.error || removeDuplicates.error} />
    </div>
  )
}

type Handle = Record<string, unknown>

/** One sortable tile. The drag handle's props go to whichever element should start a drag. */
function SortableTile({ id, compact, label, isCover, children }: { id: string; compact: boolean; label: string; isCover: boolean; children: (handle: Handle, dragArea: Handle) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  const handle: Handle = { ...attributes, ...listeners, ref: setActivatorNodeRef }
  return (
    <li ref={setNodeRef} style={style} className={`album-tile ${isDragging ? 'placeholder' : ''} ${isCover ? 'is-cover' : ''} ${compact ? 'compact' : ''}`} aria-label={label}>
      {children(handle, { ...listeners })}
    </li>
  )
}

function TileImage({ m, position, isCover }: { m: OrganiserMedia; position: number; isCover: boolean }) {
  return (
    <div className="album-tile-img">
      <img src={m.previewUrl} alt={m.caption || m.altText || 'Album photo'} loading="lazy" draggable={false} />
      <span className="album-tile-pos" aria-hidden="true">
        {position}
      </span>
      {isCover && <span className="album-tile-cover">Title photo</span>}
      {m.isVideo && (
        <span className="video-badge" aria-label="Video">
          ▶{m.durationSec ? ` ${formatDuration(m.durationSec)}` : ''}
        </span>
      )}
    </div>
  )
}

function AlbumCaption({ orgSlug, media, onChanged }: { orgSlug: string; media: OrganiserMedia; onChanged: () => void }) {
  const save = useMutation({
    mutationFn: (caption: string) => patch(`${orgApi(orgSlug)}/media/${media.id}`, { caption }),
    onSuccess: onChanged,
  })
  return (
    <div className="album-tile-caption">
      <div className="label-with-status">
        <label htmlFor={`album-caption-${media.id}`}>Caption</label>
        <SaveIndicator state={save.isPending ? 'saving' : save.isError ? 'error' : save.isSuccess ? 'saved' : 'idle'} />
      </div>
      <input
        id={`album-caption-${media.id}`}
        type="text"
        maxLength={300}
        defaultValue={media.caption}
        placeholder="Add a caption (optional)"
        onBlur={(e) => {
          if (e.target.value.trim() !== media.caption) save.mutate(e.target.value.trim())
        }}
      />
      <MutationError error={save.error} />
    </div>
  )
}
