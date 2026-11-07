import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, orgApi, post } from '../../../lib/api'
import { useAuth } from '../../../lib/auth'
import { formatDate } from '../../../lib/format'
import { useConfirm } from '../../../components/ConfirmDialog'
import { MutationError } from '../adminUi'

type BinItem = { id: string; guestName: string; hadReview: boolean; photoCount: number; deletedAt: string; purgeAfter: string }

const daysLeft = (purgeAfter: string) => Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - Date.now()) / 86_400_000))

/**
 * Deleted reviews, under the programme's responses: each one restored exactly (guest, review, photos
 * and videos, and their link) or deleted for good. Emptied by itself after 30 days.
 */
export function RecycleBin({ orgSlug, retreatId, justBinned }: { orgSlug: string; retreatId: string; justBinned?: boolean }) {
  const key = ['admin', orgSlug, 'recycle-bin', retreatId]
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { session } = useAuth()
  const isOwner = Boolean(session?.user.isPlatformAdmin || session?.memberships.find((m) => m.slug === orgSlug)?.role === 'owner')
  const q = useQuery({ queryKey: key, queryFn: () => get<{ items: BinItem[]; days: number }>(`${orgApi(orgSlug)}/retreats/${retreatId}/recycle-bin`) })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', orgSlug] })
  const restore = useMutation({ mutationFn: (id: string) => post(`${orgApi(orgSlug)}/recycle-bin/${id}/restore`), onSuccess: refresh })
  const purge = useMutation({ mutationFn: (id: string) => del(`${orgApi(orgSlug)}/recycle-bin/${id}`), onSuccess: refresh })

  const items = q.data?.items ?? []
  if (!items.length && !justBinned) return null
  return (
    <section className="card recycle-bin" aria-labelledby="bin-title" style={{ marginTop: '1.5rem' }}>
      <h2 id="bin-title" style={{ marginTop: 0 }}>
        Recycle bin
      </h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Deleted reviews stay here for {q.data?.days ?? 30} days with their photos and videos, then they’re deleted for good. Restoring brings back the
        guest, their review and their link exactly as they were.
      </p>
      {justBinned && items.length > 0 && (
        <p className="notice ok small" role="status">
          Moved to the recycle bin.
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted small">The recycle bin is empty.</p>
      ) : (
        <ul className="bin-list">
          {items.map((b) => (
            <li key={b.id} className="bin-item">
              <div>
                <strong>{b.guestName}</strong>
                <div className="small muted">
                  {b.hadReview ? 'Review' : 'Unsent draft'}
                  {b.photoCount > 0 && ` · ${b.photoCount} photo${b.photoCount === 1 ? '' : 's'} or video${b.photoCount === 1 ? '' : 's'}`} · deleted{' '}
                  {formatDate(b.deletedAt)} · {daysLeft(b.purgeAfter)} day{daysLeft(b.purgeAfter) === 1 ? '' : 's'} left
                </div>
              </div>
              {isOwner && (
                <div className="row" style={{ gap: '0.5rem' }}>
                  <button type="button" className="btn small" disabled={restore.isPending} onClick={() => restore.mutate(b.id)}>
                    Restore
                  </button>
                  <button
                    type="button"
                    className="btn danger small"
                    disabled={purge.isPending}
                    onClick={() =>
                      void confirm({
                        title: `Delete ${b.guestName}’s review for good?`,
                        message: 'The review, its photos and videos are deleted now and can’t be restored.',
                        confirmLabel: 'Delete for good',
                        danger: true,
                      }).then((ok) => ok && purge.mutate(b.id))
                    }
                  >
                    Delete for good
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {restore.error && <MutationError error={restore.error} />}
      {purge.error && <MutationError error={purge.error} />}
    </section>
  )
}
