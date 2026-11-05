import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, orgApi, patch, post } from '../../../lib/api'
import { Field, Switch } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { MutationError, retreatKey } from '../adminUi'
import type { OrganiserMedia, Retreat } from '../types'
import { AlbumGrid } from './AlbumGrid'
import { videoPoster } from '../../../lib/videoPoster'
import { UploadZone } from '../../../components/UploadZone'
import { IMAGE_ACCEPT, isImageFile, MAX_UPLOAD_MB, prepareImage } from '../../../lib/prepareImage'

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
    queryFn: () => get<{
        coverId: string | null
        pageUrl: string | null
        media: OrganiserMedia[]
        limits: { maxPhotos: number; maxVideos: number }
        usage: { photos: number; videos: number }
      }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/album`),
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
  async function uploadAll(files: File[]) {
    const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(f.name)
    const isImage = (f: File) => !isVideo(f) && isImageFile(f)
    const usable = files.filter((f) => isImage(f) || isVideo(f))
    const failed = files.filter((f) => !usable.includes(f)).map((f) => ({ name: f.name, message: 'Not a photo or video' }))
    for (const f of usable.filter(isVideo)) {
      if (f.size > MAX_VIDEO_MB * 1024 * 1024) failed.push({ name: f.name, message: `Videos can be up to ${MAX_VIDEO_MB} MB` })
    }
    let queue = usable.filter((f) => !failed.some((x) => x.name === f.name))
    // Keep within the album's limits, saying which files didn't fit.
    const limits = photos.data?.limits
    const usage = photos.data?.usage
    if (limits && usage) {
      let photoRoom = Math.max(0, limits.maxPhotos - usage.photos)
      let videoRoom = Math.max(0, limits.maxVideos - usage.videos)
      queue = queue.filter((f) => {
        if (isVideo(f) ? videoRoom-- > 0 : photoRoom-- > 0) return true
        failed.push({ name: f.name, message: isVideo(f) ? `The album holds up to ${limits.maxVideos} videos` : `The album holds up to ${limits.maxPhotos} photos` })
        return false
      })
    }
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
          data.append('image', await prepareImage(file))
          await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/media?album=1`, data)
        }
      } catch (e) {
        failed.push({ name: file.name, message: e instanceof ApiError || e instanceof Error ? e.message : 'Upload failed' })
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

      {photos.data && (
        <p className="row small album-usage" style={{ margin: '0 0 0.6rem' }}>
          <span className={`badge ${photos.data.usage.photos >= photos.data.limits.maxPhotos ? 'warn' : 'neutral'}`}>
            Photos {photos.data.usage.photos} of {photos.data.limits.maxPhotos}
          </span>
          <span className={`badge ${photos.data.usage.videos >= photos.data.limits.maxVideos ? 'warn' : 'neutral'}`}>
            Videos {photos.data.usage.videos} of {photos.data.limits.maxVideos}
          </span>
          <span className="muted">Guests’ own photos don’t count.</span>
        </p>
      )}
      <UploadZone
        id="album-upload"
        title="Choose photos and videos to upload"
        hint={`Pick several at once, or drag them here. Photos: JPG, PNG, WebP or HEIC, up to ${MAX_UPLOAD_MB} MB, kept in high quality (up to 4K). Videos: MP4, MOV or WebM, up to ${MAX_VIDEO_MB} MB. Everything here is public, linked from your retreat page, so only include people who are happy to be shared.`}
        accept={`${IMAGE_ACCEPT},video/mp4,video/quicktime,video/webm`}
        busy={Boolean(progress)}
        busyLabel={progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : undefined}
        disabled={Boolean(photos.data && photos.data.usage.photos >= photos.data.limits.maxPhotos && photos.data.usage.videos >= photos.data.limits.maxVideos)}
        onFiles={(files) => void uploadAll(files)}
      />
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
