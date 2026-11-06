import { useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, orgApi, patch, post } from '../../../lib/api'
import { Field } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { MutationError, retreatKey } from '../adminUi'
import type { OrganiserMedia, Retreat } from '../types'
import { AlbumGrid } from './AlbumGrid'
import { videoPoster } from '../../../lib/videoPoster'
import { UploadZone } from '../../../components/UploadZone'
import { IMAGE_ACCEPT, isImageFile, MAX_UPLOAD_MB, prepareImage, captureTimeOf } from '../../../lib/prepareImage'
import { useConfirm } from '../../../components/ConfirmDialog'
import { FILM_STYLES, type FilmMusic } from '../../../../shared/film'
import { FilmMusicPicker } from '../../../components/FilmMusicPicker'

/** Matches the server's MAX_VIDEO_BYTES default. */
const MAX_VIDEO_MB = 200

/**
 * Itinerary retreats: a thank-you photo album each guest unlocks by sending their review. It's
 * teased (blurred) on the guest's welcome screen to encourage reviews. It also has its own public page,
 * linked from the retreat page and stories, which anyone can view without signing in.
 * The reward depends only on sending a review, never on its rating or on agreeing to publish anything.
 */
export function AlbumSection({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const confirm = useConfirm()
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
        duplicates?: Record<string, string>
      }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/album`),
  })
  const [url, setUrl] = useState(retreat.rewardAlbumUrl ?? '')
  const [note, setNote] = useState(retreat.rewardAlbumNote ?? '')
  const [saved, setSaved] = useState<string | null>(null)
  const settings = useMutation({
    mutationFn: (body: Partial<Pick<Retreat, 'rewardAlbumEnabled' | 'rewardAlbumUrl' | 'rewardAlbumNote' | 'filmMusic' | 'filmStyle'>>) =>
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
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
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
          data.append('rightsConfirmed', 'true')
          if (meta.poster) data.append('poster', meta.poster, 'poster.jpg')
          if (meta.width) data.append('width', String(meta.width))
          if (meta.height) data.append('height', String(meta.height))
          if (meta.duration) data.append('duration', String(meta.duration))
          await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/album/videos`, data)
        } else {
          data.append('image', await prepareImage(file))
          data.append('takenAt', await captureTimeOf(file))
          data.append('rightsConfirmed', 'true')
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

  const count = photos.data?.media.filter((m) => m.inAlbum && m.approved).length ?? 0
  const pending = photos.data?.media.filter((m) => m.inAlbum && m.kind === 'guest' && !m.approved).length ?? 0
  const live = retreat.rewardAlbumEnabled && (count > 0 || Boolean(retreat.rewardAlbumUrl))

  // Photos and videos can be dropped anywhere on the album, not only on the upload box.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const dropProps = retreat.rewardAlbumEnabled
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          dragDepth.current++
          setDropping(true)
        },
        onDragOver: (e: DragEvent) => {
          if (hasFiles(e)) e.preventDefault()
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFiles(e)) return
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDropping(false)
        },
        onDrop: (e: DragEvent) => {
          dragDepth.current = 0
          setDropping(false)
          // The upload box handles drops on itself (and marks them handled).
          if (e.defaultPrevented || !hasFiles(e)) return
          e.preventDefault()
          void uploadAll(Array.from(e.dataTransfer.files))
        },
      }
    : {}

  return (
    <section className={`card site-setup-panel album-drop-area ${dropping ? 'is-dropping' : ''}`} aria-labelledby="album-title" {...dropProps}>
      {dropping && (
        <div className="album-drop-overlay" aria-hidden="true">
          <span>Drop photos or videos to add them to the album</span>
        </div>
      )}
      <h2 id="album-title">Photo album</h2>
      <div className="site-album-status">
        <div>
          <strong>{retreat.rewardAlbumEnabled ? 'Album available after a guest sends a review' : 'Album is off'}</strong>
          <p className="small muted">{retreat.rewardAlbumEnabled ? (live ? `${count} photo${count === 1 ? '' : 's'} visible${pending ? ` · ${pending} awaiting approval` : ''}.` : `Add photos or a full-album link so guests have something to view.${pending ? ` ${pending} guest photo(s) await approval.` : ''}`) : 'Guests will not receive the album link.'}</p>
        </div>
        {retreat.rewardAlbumEnabled && pageLink && <a className="btn secondary small" href={pageLink} target="_blank" rel="noopener noreferrer">Open album ↗</a>}
        <button type="button" className={`btn small ${retreat.rewardAlbumEnabled ? 'ghost' : ''}`} disabled={settings.isPending} onClick={() => settings.mutate({ rewardAlbumEnabled: !retreat.rewardAlbumEnabled })}>
          {retreat.rewardAlbumEnabled ? 'Turn off album' : 'Make album available'}
        </button>
      </div>
      <p className="small muted">When available, guests receive the album link after sending a review, whatever they choose to share or rate. Anyone with the link can view the album without signing in. Guest photos appear only after you approve them.</p>

      {retreat.rewardAlbumEnabled && pageLink && (
        <div className="site-album-link">
          <label htmlFor="album-page-link" style={{ fontWeight: 600 }}>
            Album link
          </label>
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
          </div>
          <details><summary>Link options</summary><p className="small muted">A new link stops the current one working for everyone who has it. The public retreat page updates automatically.</p>
            <button type="button" className="btn ghost small" disabled={newLink.isPending} onClick={() => void confirm({ title: 'Make a new album link?', message: 'The current link stops working for everyone who has it, including guests. Your retreat page switches to the new one automatically.', confirmLabel: 'Make new link', danger: true }).then((ok) => ok && newLink.mutate())}>Make a new link</button>
          </details>
          <MutationError error={newLink.error} />
        </div>
      )}

      {retreat.rewardAlbumEnabled && pageLink && (
        <div className="site-album-film">
          <div>
            <strong>Memory film</strong>
            <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
              Everyone who opens the album can press <em>Play memories</em> to watch it as a short film: the photos and videos in the order
              below, with music. It plays in their browser and can’t be downloaded.
            </p>
          </div>
          <fieldset className="film-music-picker">
            <legend>How photos are shown</legend>
            {FILM_STYLES.map((s) => (
              <div key={s.id} className={`film-music-option ${(retreat.filmStyle ?? 'mix') === s.id ? 'is-chosen' : ''}`}>
                <label>
                  <input type="radio" name="film-style" value={s.id} checked={(retreat.filmStyle ?? 'mix') === s.id} disabled={settings.isPending} onChange={() => settings.mutate({ filmStyle: s.id })} />
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.hint}</small>
                  </span>
                </label>
              </div>
            ))}
          </fieldset>
          <FilmMusicPicker value={(retreat.filmMusic ?? 'calm') as FilmMusic} disabled={settings.isPending} onChange={(music) => settings.mutate({ filmMusic: music })} />
          <div>
            <a className="btn secondary small" href={`${pageLink}?film=1`} target="_blank" rel="noopener noreferrer">
              ▶ Play memories ↗
            </a>
            <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
              {(retreat.filmStyle ?? 'mix') === 'mix'
                ? '6 seconds per screen; a big album is gathered into collages so the film stays to a few minutes.'
                : (retreat.filmStyle ?? 'mix') === 'single'
                  ? '6 seconds per photo, so the film’s length grows with the album (100 photos ≈ 10 minutes).'
                  : '5 seconds per photo, so the film’s length grows with the album (100 photos ≈ 8 minutes).'}
            </p>
          </div>
        </div>
      )}

      <details className="site-album-extras"><summary>Album message &amp; external full-resolution link</summary><div className="grid-2">
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
      </div></details>
      <p className="small muted" aria-live="polite" style={{ margin: '-0.5rem 0 1rem', minHeight: '1.3em' }}>
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
      <p className="site-consent-note"><span aria-hidden="true">✓</span> By uploading, you confirm you have permission to share these photos or videos and that people pictured have agreed.</p>
      <UploadZone
        id="album-upload"
        title="Add photos or videos"
        hint={`Photos up to ${MAX_UPLOAD_MB} MB · videos up to ${MAX_VIDEO_MB} MB · location and camera details removed; only the time taken is kept`}
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
          duplicates={photos.data.duplicates ?? {}}
          onChanged={() => queryClient.invalidateQueries({ queryKey: key })}
        />
      )}
    </section>
  )
}
