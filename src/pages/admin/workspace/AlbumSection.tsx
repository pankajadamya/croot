import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, del, get, orgApi, patch, post } from '../../../lib/api'
import { Field, Switch } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { MutationError, retreatKey } from '../adminUi'
import type { OrganiserMedia, Retreat } from '../types'

/**
 * Itinerary retreats: a thank-you photo album each guest unlocks by sending their review. It's
 * teased (blurred) on the guest's welcome screen to encourage reviews. Album photos are never public.
 * The reward depends only on sending a review, never on its rating or on agreeing to publish anything.
 */
export function AlbumSection({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const queryClient = useQueryClient()
  const key = ['admin', orgSlug, 'album', retreat.id]
  const photos = useQuery({
    queryKey: key,
    queryFn: () => get<{ media: OrganiserMedia[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/media?album=1`).then((r) => r.media),
  })
  const [url, setUrl] = useState(retreat.rewardAlbumUrl ?? '')
  const [note, setNote] = useState(retreat.rewardAlbumNote ?? '')
  const [saved, setSaved] = useState<string | null>(null)
  const settings = useMutation({
    mutationFn: (body: Partial<Pick<Retreat, 'rewardAlbumEnabled' | 'rewardAlbumUrl' | 'rewardAlbumNote'>>) =>
      patch(`${orgApi(orgSlug)}/retreats/${retreat.id}`, body),
    onSuccess: async () => {
      setSaved('Saved')
      await queryClient.invalidateQueries({ queryKey: retreatKey(orgSlug, retreat.id) })
    },
  })

  // Several photos at once, one after another, as in "Your images".
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([])
  const [dragging, setDragging] = useState(false)
  async function uploadAll(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name))
    const failed = files.filter((f) => !images.includes(f)).map((f) => ({ name: f.name, message: 'Not an image' }))
    setFailures(failed)
    if (!images.length) return
    setProgress({ done: 0, total: images.length })
    for (const [i, file] of images.entries()) {
      const data = new FormData()
      data.append('image', file)
      try {
        await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/media?album=1`, data)
      } catch (e) {
        failed.push({ name: file.name, message: e instanceof ApiError ? e.message : 'Upload failed' })
      }
      setProgress({ done: i + 1, total: images.length })
      void queryClient.invalidateQueries({ queryKey: key })
    }
    setFailures([...failed])
    setProgress(null)
  }

  const count = photos.data?.length ?? 0
  const live = retreat.rewardAlbumEnabled && (count > 0 || Boolean(retreat.rewardAlbumUrl))

  return (
    <section className="card" aria-labelledby="album-title" style={{ marginTop: '1.5rem' }}>
      <h2 id="album-title">Photo album for guests who review</h2>
      <p className="small muted" style={{ maxWidth: '70ch' }}>
        A thank-you that encourages reviews. Guests see a blurred preview when they open their review link, and the album unlocks as soon as they
        send their review, <strong>whatever they choose to share or rate</strong>. Album photos are never shown on the public site.
      </p>

      <div className="panel-sage" style={{ margin: '1rem 0' }}>
        <Switch
          checked={retreat.rewardAlbumEnabled}
          disabled={settings.isPending}
          onChange={(v) => settings.mutate({ rewardAlbumEnabled: v })}
          label="Unlock a photo album for guests who send their review"
          description={
            retreat.rewardAlbumEnabled
              ? live
                ? `On: ${count} photo${count === 1 ? '' : 's'}${retreat.rewardAlbumUrl ? ' and a link to the full album' : ''}.`
                : 'On, but add photos or a link below before guests will see it.'
              : 'Off: guests won’t see an album.'
          }
        />
      </div>

      <div className="grid-2">
        <Field id="album-url" label="Link to the full album (optional)" hint="E.g. a shared Google Photos or Dropbox album with full-resolution photos.">
          <input
            id="album-url"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setSaved(null)
            }}
            onBlur={() => url !== (retreat.rewardAlbumUrl ?? '') && settings.mutate({ rewardAlbumUrl: url.trim() || null })}
          />
        </Field>
        <Field id="album-note" label="Thank-you note (optional)" hint="Shown with the album once it’s unlocked.">
          <textarea
            id="album-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setSaved(null)
            }}
            onBlur={() => note !== (retreat.rewardAlbumNote ?? '') && settings.mutate({ rewardAlbumNote: note })}
            style={{ minHeight: '4.5rem' }}
          />
        </Field>
      </div>
      <p className="small muted" aria-live="polite" style={{ margin: '-0.5rem 0 1rem' }}>
        {settings.isPending ? 'Saving…' : saved}
      </p>
      <MutationError error={settings.error} />

      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!progress) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!progress) void uploadAll(Array.from(e.dataTransfer.files))
        }}
      >
        <label htmlFor="album-upload" style={{ fontWeight: 600 }}>
          Add album photos
        </label>
        <span className="hint" id="album-upload-hint">
          Choose several at once, or drag them here. Only guests who sent a review can see them. If others appear in a photo, include it only if
          they’re happy for fellow guests to see it.
        </span>
        <input
          id="album-upload"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="album-upload-hint"
          disabled={Boolean(progress)}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) void uploadAll(files)
          }}
        />
      </div>
      {progress && (
        <div role="status" aria-live="polite" style={{ marginTop: '0.75rem' }}>
          <span className="small">
            Uploading {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </span>
          <div className="upload-bar" aria-hidden="true">
            <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}
      {failures.length > 0 && (
        <div className="notice error small" role="alert" style={{ marginTop: '0.75rem' }}>
          {failures.length === 1 ? 'One file wasn’t uploaded:' : `${failures.length} files weren’t uploaded:`}
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
            {failures.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                {f.name}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.isLoading && <Loading />}
      {photos.error && <ErrorNotice error={photos.error} />}
      {photos.data && photos.data.length > 0 && (
        <ul className="album-admin-grid">
          {photos.data.map((p) => (
            <AlbumPhoto key={p.id} orgSlug={orgSlug} photo={p} onChanged={() => queryClient.invalidateQueries({ queryKey: key })} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One album photo: a caption that saves on leaving the field, and delete. */
function AlbumPhoto({ orgSlug, photo, onChanged }: { orgSlug: string; photo: OrganiserMedia; onChanged: () => void }) {
  const [caption, setCaption] = useState(photo.caption)
  const save = useMutation({ mutationFn: (c: string) => patch(`${orgApi(orgSlug)}/media/${photo.id}`, { caption: c }) })
  const remove = useMutation({ mutationFn: () => del(`${orgApi(orgSlug)}/media/${photo.id}`), onSuccess: onChanged })
  return (
    <li>
      <img src={photo.previewUrl} alt={photo.caption || 'Album photo'} loading="lazy" />
      <label className="sr-only" htmlFor={`cap-${photo.id}`}>
        Caption
      </label>
      <input
        id={`cap-${photo.id}`}
        type="text"
        placeholder="Caption (optional)"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => caption !== photo.caption && save.mutate(caption)}
      />
      <div className="spread small">
        <span className="muted" aria-live="polite">
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : save.isError ? 'Couldn’t save' : ''}
        </span>
        <button
          type="button"
          className="btn ghost small"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm('Remove this photo from the album?')) remove.mutate()
          }}
        >
          Remove
        </button>
      </div>
    </li>
  )
}
