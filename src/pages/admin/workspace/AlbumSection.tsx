import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, orgApi, patch, post } from '../../../lib/api'
import { Field, Switch } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { MutationError, retreatKey } from '../adminUi'
import type { OrganiserMedia, Retreat } from '../types'
import { AlbumGrid } from './AlbumGrid'
import { videoPoster } from '../../../lib/videoPoster'

/** Matches the server's MAX_VIDEO_BYTES default. */
const MAX_VIDEO_MB = 200

/**
 * Itinerary retreats: a thank-you photo album each guest unlocks by sending their review. It's
 * teased (blurred) on the guest's welcome screen to encourage reviews. It also has its own public page,
 * linked from the retreat page and stories, which anyone can view without signing in.
 * The reward depends only on sending a review, never on its rating or on agreeing to publish anything.
 */
export function AlbumSection({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const queryClient = useQueryClient()
  const key = ['admin', orgSlug, 'album', retreat.id]
  const photos = useQuery({
    queryKey: key,
    // Everything that can be in the album: its uploads and the earlier images from "Your images".
    queryFn: () => get<{ coverId: string | null; pageUrl: string | null; media: OrganiserMedia[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/album`),
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

  const pageLink = photos.data?.pageUrl ? new URL(photos.data.pageUrl, window.location.origin).toString() : null
  const newLink = useMutation({
    mutationFn: () => post<{ pageUrl: string }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/album/share-link`),
    onSuccess: () => {
      setCopied(false)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const [copied, setCopied] = useState(false)

  // Several photos at once, one after another, as in "Your images".
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([])
  const [dragging, setDragging] = useState(false)
  async function uploadAll(files: File[]) {
    const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(f.name)
    const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name)
    const usable = files.filter((f) => isImage(f) || isVideo(f))
    const failed = files.filter((f) => !usable.includes(f)).map((f) => ({ name: f.name, message: 'Not a photo or video' }))
    for (const f of usable.filter(isVideo)) {
      if (f.size > MAX_VIDEO_MB * 1024 * 1024) failed.push({ name: f.name, message: `Videos can be up to ${MAX_VIDEO_MB} MB` })
    }
    const queue = usable.filter((f) => !failed.some((x) => x.name === f.name))
    setFailures(failed)
    if (!queue.length) return
    setProgress({ done: 0, total: queue.length })
    for (const [i, file] of queue.entries()) {
      const data = new FormData()
      try {
        if (isVideo(file)) {
          // The browser picks a poster frame and reads the size and length; the server stores the rest.
          const meta = await videoPoster(file)
          data.append('video', file)
          if (meta.poster) data.append('poster', meta.poster, 'poster.jpg')
          if (meta.width) data.append('width', String(meta.width))
          if (meta.height) data.append('height', String(meta.height))
          if (meta.duration) data.append('duration', String(meta.duration))
          await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/album/videos`, data)
        } else {
          data.append('image', file)
          await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/media?album=1`, data)
        }
      } catch (e) {
        failed.push({ name: file.name, message: e instanceof ApiError ? e.message : 'Upload failed' })
      }
      setProgress({ done: i + 1, total: queue.length })
      void queryClient.invalidateQueries({ queryKey: key })
    }
    setFailures([...failed])
    setProgress(null)
  }

  const count = photos.data?.media.filter((m) => m.inAlbum).length ?? 0
  const live = retreat.rewardAlbumEnabled && (count > 0 || Boolean(retreat.rewardAlbumUrl))

  return (
    <section className="card" aria-labelledby="album-title" style={{ marginTop: '1.5rem' }}>
      <h2 id="album-title">Photo album</h2>
      <p className="small muted" style={{ maxWidth: '70ch' }}>
        A thank-you that encourages reviews. Guests see a blurred preview when they open their review link, and get the album link as soon as
        they send their review, <strong>whatever they choose to share or rate</strong>. They can add their own photos, which appear once you
        approve them. The album is linked from the top of your public retreat page, and anyone can view it without signing in.
      </p>

      <div className="panel-sage" style={{ margin: '1rem 0' }}>
        <Switch
          checked={retreat.rewardAlbumEnabled}
          disabled={settings.isPending}
          onChange={(v) => settings.mutate({ rewardAlbumEnabled: v })}
          label="Give guests the album link when they send their review"
          description={
            retreat.rewardAlbumEnabled
              ? live
                ? `Guests who send their review will unlock ${count > 0 ? `${count} photo${count === 1 ? '' : 's'}` : ''}${count > 0 && retreat.rewardAlbumUrl ? ' and ' : ''}${retreat.rewardAlbumUrl ? 'the full-album link' : ''}.`
                : 'Add photos or a link below so guests have something to unlock.'
              : 'Guests won’t see an album.'
          }
        />
      </div>

      {retreat.rewardAlbumEnabled && pageLink && (
        <div className="stack" style={{ gap: '0.4rem', marginBottom: '1rem' }}>
          <label htmlFor="album-page-link" style={{ fontWeight: 600 }}>
            Album link
          </label>
          <span className="hint">The album’s address, also linked from your public retreat page. Anyone can view it without signing in. Making a new link updates the retreat page too.</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input id="album-page-link" readOnly value={pageLink} onFocus={(e) => e.target.select()} style={{ flex: '1 1 22rem' }} />
            <button
              type="button"
              className="btn secondary small"
              onClick={() =>
                void navigator.clipboard.writeText(pageLink).then(
                  () => setCopied(true),
                  () => window.prompt('Copy the album link:', pageLink),
                )
              }
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className="btn ghost small" href={pageLink} target="_blank" rel="noopener noreferrer">
              Open
            </a>
            <button
              type="button"
              className="btn ghost small"
              disabled={newLink.isPending}
              onClick={() => window.confirm('Make a new album link? The current one will stop working for everyone who has it, including guests.') && newLink.mutate()}
            >
              Make a new link
            </button>
          </div>
          <MutationError error={newLink.error} />
        </div>
      )}

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
          Add album photos and videos
        </label>
        <span className="hint" id="album-upload-hint">
          Choose several at once, or drag them here. Videos: MP4, MOV or WebM, up to {MAX_VIDEO_MB} MB each. They’re public, linked from your retreat page. If others appear
          in a photo, include it only if they’re happy for it to be shared.
        </span>
        <input
          id="album-upload"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
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
      {photos.data && (
        <AlbumGrid
          orgSlug={orgSlug}
          retreatId={retreat.id}
          coverId={photos.data.coverId}
          media={photos.data.media}
          onChanged={() => queryClient.invalidateQueries({ queryKey: key })}
        />
      )}
    </section>
  )
}
