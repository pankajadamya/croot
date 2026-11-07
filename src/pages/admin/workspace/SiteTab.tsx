import { thumb } from '../../../lib/thumb'
import { useState, type FormEvent } from 'react'
import { useUrlState } from '../../../lib/useUrlState'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, orgApi, patch, post, put } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { Field, Switch } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { ThemeScope } from '../../../components/ThemeScope'
import { fieldError, fromLocalInput, MutationError, retreatKey, toLocalInput } from '../adminUi'
import type { ContentRevision, OrganiserMedia, Retreat } from '../types'
import { useRetreatTheme } from './AppearanceTab'
import { AlbumSection } from './AlbumSection'
import { MediaEditor } from './MediaEditor'
import { MAX_SLIDESHOW, SlideshowSettings } from './SlideshowSettings'
import { UploadZone } from '../../../components/UploadZone'
import { IMAGE_ACCEPT, isImageFile, MAX_UPLOAD_MB, prepareImage, captureTimeOf } from '../../../lib/prepareImage'
import { useConfirm } from '../../../components/ConfirmDialog'

interface ContentState {
  draft: ContentRevision | null
  published: ContentRevision | null
}

export function SiteTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  // Kept in the address (?section=album), so a refresh stays on the same section.
  const [section, setSection] = useUrlState('section', 'opening', ['opening', 'visibility', 'images', 'album'] as const)
  const content = useQuery({
    queryKey: ['admin', orgSlug, 'content', retreat.id],
    queryFn: () => get<ContentState>(`${orgApi(orgSlug)}/retreats/${retreat.id}/content`),
  })
  return (
    <div className="site-setup">
      <nav className="site-setup-nav" aria-label="Public site setup">
        <h2>Page setup</h2>
        {([
          ['opening', 'Opening'],
          ['visibility', 'Visitor visibility'],
          ['images', 'Slideshow images'],
          ...(retreat.kind === 'itinerary' ? [['album', 'Photo album']] : []),
        ] as Array<[typeof section, string]>).map(([key, label]) => (
          <button key={key} type="button" className={section === key ? 'is-active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}>
            <span>{label}</span>
            {key === 'opening' && <span className="badge ok">{content.data?.published ? 'Live' : 'Draft'}</span>}
            {key === 'album' && <span className="badge neutral">{retreat.rewardAlbumEnabled ? 'On' : 'Off'}</span>}
          </button>
        ))}
      </nav>
      <div className="site-setup-mobile">
        <label htmlFor="site-setup-section">Page setup</label>
        <select id="site-setup-section" value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
          <option value="opening">Opening</option>
          <option value="visibility">Visitor visibility</option>
          <option value="images">Slideshow images</option>
          {retreat.kind === 'itinerary' && <option value="album">Photo album</option>}
        </select>
      </div>
      <div className="site-setup-content">
        <div hidden={section !== 'opening'}>
          {content.isLoading && <Loading />}
          {content.error && <ErrorNotice error={content.error} />}
          {content.data && <OpeningEditor key={content.data.draft?.id ?? content.data.published?.id ?? 'new'} orgSlug={orgSlug} retreat={retreat} state={content.data} />}
        </div>
        <div hidden={section !== 'visibility'}><VisitorSettings orgSlug={orgSlug} retreat={retreat} /></div>
        <div hidden={section !== 'images'}><ImageLibrary orgSlug={orgSlug} retreat={retreat} /></div>
        {retreat.kind === 'itinerary' && <div hidden={section !== 'album'}><AlbumSection orgSlug={orgSlug} retreat={retreat} /></div>}
      </div>
    </div>
  )
}

function OpeningEditor({ orgSlug, retreat, state }: { orgSlug: string; retreat: Retreat; state: ContentState }) {
  const queryClient = useQueryClient()
  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}/content`
  const source = state.draft ?? state.published
  const [headline, setHeadline] = useState(source?.headline ?? '')
  const [paragraphs, setParagraphs] = useState<string[]>(() => [0, 1, 2].map((i) => source?.introParagraphs[i] ?? ''))
  const [ctaLabel, setCtaLabel] = useState(source?.ctaLabel ?? '')
  const [ctaUrl, setCtaUrl] = useState(source?.ctaUrl ?? '')
  const [publishAt, setPublishAt] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const theme = useRetreatTheme(orgSlug, retreat.id)

  const body = () => ({ headline, introParagraphs: paragraphs.map((p) => p.trim()).filter(Boolean), ctaLabel, ctaUrl: ctaUrl.trim() })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', orgSlug, 'content', retreat.id] })

  const saveDraft = useMutation({
    mutationFn: () => put(base, body()),
    onSuccess: () => {
      setMessage('Draft saved. Visitors still see the published version.')
      void invalidate()
    },
  })
  // Publishing snapshots the saved draft, so save the form first.
  const publish = useMutation({
    mutationFn: async (when: string | null) => {
      await put(base, body())
      await post(`${base}/publish`, { publishAt: when })
      return when
    },
    onSuccess: (when) => {
      setMessage(when ? `Scheduled to go live ${formatDateTime(when)}.` : 'Published. Visitors now see this opening.')
      setPublishAt('')
      void invalidate()
    },
  })
  const unpublish = useMutation({
    mutationFn: () => post(`${base}/unpublish`),
    onSuccess: () => {
      setMessage('Opening unpublished. The public page shows the retreat facts and guest stories without it.')
      void invalidate()
    },
  })
  const error = saveDraft.error || publish.error || unpublish.error

  const pub = state.published
  const scheduled = pub?.publishAt && new Date(pub.publishAt) > new Date()

  function submit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    saveDraft.mutate()
  }

  const previewParagraphs = paragraphs.filter((p) => p.trim())
  const hasUnsavedChanges = headline !== (source?.headline ?? '') || paragraphs.some((p, i) => p !== (source?.introParagraphs[i] ?? '')) || ctaLabel !== (source?.ctaLabel ?? '') || ctaUrl !== (source?.ctaUrl ?? '')

  return (
    <section className="card site-setup-panel" aria-labelledby="opening-title">
      <div className="spread">
        <h2 id="opening-title" style={{ margin: 0 }}>
          Your opening
        </h2>
        <span className={`badge ${pub ? (scheduled ? 'warn' : 'ok') : 'neutral'}`}>
          {pub ? (scheduled ? `Scheduled for ${formatDateTime(pub.publishAt)}` : `Live since ${formatDateTime(pub.publishAt ?? pub.createdAt)}`) : 'Not published'}
        </span>
      </div>
      <p className="small muted">The headline and introduction visitors see first, in your own words. Publishing or unpublishing this never affects guest stories.</p>
      <p className="row small" aria-live="polite"><span className={`badge ${pub ? 'ok' : 'neutral'}`}>{pub ? 'Published' : 'Draft'}</span>{hasUnsavedChanges && <span className="badge warn">Unsaved changes</span>}</p>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form onSubmit={submit} noValidate>
          <Field id="op-headline" label="Headline" error={fieldError(error, 'headline')}>
            <input id="op-headline" type="text" maxLength={160} value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </Field>
          {paragraphs.map((p, i) => i === 2 ? (
            <details key={i} className="site-optional-field" open={Boolean(p.trim())}>
              <summary>{p.trim() ? 'Introduction paragraph 3 (optional)' : 'Add third paragraph (optional)'}</summary>
              <Field id="op-p2" label="Introduction paragraph 3 (optional)">
                <textarea id="op-p2" maxLength={800} value={p} onChange={(e) => setParagraphs((all) => all.map((x, j) => j === i ? e.target.value : x))} />
              </Field>
            </details>
          ) : (
            <Field key={i} id={`op-p${i}`} label={`Introduction paragraph ${i + 1}${i > 0 ? ' (optional)' : ''}`}>
              <textarea
                id={`op-p${i}`}
                style={{ minHeight: '6rem' }}
                maxLength={800}
                value={p}
                onChange={(e) => setParagraphs((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </Field>
          ))}
          {fieldError(error, 'introParagraphs') && <p className="small" style={{ color: 'var(--danger)' }}>{fieldError(error, 'introParagraphs')}</p>}
          <h3 className="site-subheading">Call to action</h3>
          <div className="site-cta-fields">
            <Field id="op-cta-label" label="Button label" hint="For example: Book the 2027 retreat" error={fieldError(error, 'ctaLabel')}>
              <input id="op-cta-label" type="text" maxLength={60} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} aria-describedby="op-cta-label-hint" />
            </Field>
            <Field id="op-cta-url" label="Button link" error={fieldError(error, 'ctaUrl')}>
              <input id="op-cta-url" type="url" placeholder="https://" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
            </Field>
          </div>
          <MutationError error={error} shownFields={['headline', 'introParagraphs', 'ctaLabel', 'ctaUrl']} />
          {message && (
            <div className="notice ok" role="status">
              {message}
            </div>
          )}
          {!pub && headline.trim() && !message && (
            <div className="notice warn" role="status">
              Visitors can’t see this opening yet. It’s a draft until you choose <strong>Publish now</strong>.
            </div>
          )}
          <div className="row">
            <button className="btn secondary" type="submit" disabled={saveDraft.isPending}>
              {saveDraft.isPending ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" className="btn" disabled={publish.isPending || !headline.trim()} onClick={() => publish.mutate(null)}>
              {pub ? 'Publish changes' : 'Publish now'}
            </button>
            {pub && (
              <button
                type="button"
                className="btn ghost"
                disabled={unpublish.isPending}
                onClick={() => {
                  unpublish.mutate()
                }}
              >
                Unpublish
              </button>
            )}
          </div>
          <details className="site-schedule"><summary>Schedule publication</summary><div className="row" style={{ alignItems: 'flex-end', marginTop: '1rem' }}>
            <div className="field" style={{ marginBottom: 0, flex: '1 1 200px' }}>
              <label htmlFor="op-when">Schedule for later</label>
              <input id="op-when" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} min={toLocalInput(new Date().toISOString())} />
            </div>
            <button type="button" className="btn secondary" disabled={!publishAt || publish.isPending || !headline.trim()} onClick={() => publish.mutate(fromLocalInput(publishAt))}>
              Schedule
            </button>
          </div></details>
        </form>

        <div>
          <p className="eyebrow">Visitor preview</p>
          <ThemeScope tokens={theme.tokens} className="site theme-preview">
            <div className="tp-inner">
              <div>
                <span className="label-chip">Written by you</span>
                <h3 className="serif" style={{ fontSize: '1.7rem', margin: '0.5rem 0' }}>
                  {headline.trim() || <span className="muted">Your headline</span>}
                </h3>
                <div className="organiser-voice">
                  {previewParagraphs.length ? previewParagraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="muted">Your introduction appears here.</p>}
                </div>
                {ctaLabel.trim() && (
                  <span className="btn" style={{ marginTop: '0.5rem' }}>
                    {ctaLabel}
                  </span>
                )}
              </div>
              <div className="tp-overlay">
                <span className="label-chip">Guest content</span>
                <p className="serif" style={{ fontSize: '1.15rem', margin: '0.5rem 0' }}>
                  Approved guest stories follow here, in each guest’s exact words.
                </p>
                <p className="small" style={{ margin: 0 }}>
                  Only stories a guest consented to and you approved are shown. You cannot edit them.
                </p>
              </div>
            </div>
          </ThemeScope>
          <p className="small muted">Shown with your {theme.source} theme.</p>
        </div>
      </div>
    </section>
  )
}

/** What visitors see on the public page. Each switch saves straight away. */
function VisitorSettings({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (body: Partial<Pick<Retreat, 'publicReviewsEnabled' | 'showPublicRating' | 'contactPublic'>>) =>
      patch<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats/${retreat.id}`, body),
    onSuccess: ({ retreat: updated }) => queryClient.setQueryData(retreatKey(orgSlug, retreat.id), updated),
  })
  return (
    <section className="card" aria-labelledby="visitors-title">
      <h2 id="visitors-title">What visitors see</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        These save as soon as you change them.
      </p>
      <div className="stack">
        <Switch
          checked={retreat.publicReviewsEnabled}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ publicReviewsEnabled: v })}
          label="Show published guest stories"
          description={retreat.publicReviewsEnabled ? 'Stories you publish appear on the page.' : 'Stories stay hidden, even ones you’ve published.'}
        />
        <Switch
          checked={retreat.showPublicRating}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ showPublicRating: v })}
          label="Show star ratings"
          description="Stars on each published story, and the average at the top."
        />
        <Switch
          checked={retreat.contactPublic}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ contactPublic: v })}
          label="Show your contact email and phone"
          description="Set them in Overview first."
        />
      </div>
      <MutationError error={update.error} />
    </section>
  )
}

function ImageLibrary({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const key = ['admin', orgSlug, 'media', retreat.id]
  const media = useQuery({ queryKey: key, queryFn: () => get<{ media: OrganiserMedia[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/media`).then((r) => r.media) })
  // Several files at once: uploaded one after another, so progress is clear and one bad file
  // (wrong type, too large) doesn't stop the rest.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([])
  const [lastBatch, setLastBatch] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const reorder = useMutation({
    mutationFn: (ids: string[]) => put(`${orgApi(orgSlug)}/retreats/${retreat.id}/media/order`, { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<OrganiserMedia[]>(key)
      if (previous) queryClient.setQueryData(key, ids.map((id) => previous.find((m) => m.id === id)).filter((m): m is OrganiserMedia => Boolean(m)))
      return { previous }
    },
    onError: (_error, _ids, context) => { if (context?.previous) queryClient.setQueryData(key, context.previous) },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }) },
  })
  const clearAll = useMutation({
    mutationFn: () => post<{ deleted: number }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/media/clear`),
    onSuccess: () => {
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['admin', orgSlug, 'album', retreat.id] })
    },
  })
  async function confirmClearAll() {
    const all = media.data ?? []
    const inAlbum = all.filter((m) => m.inAlbum).length
    const ok = await confirm({
      title: `Delete all ${all.length} image${all.length === 1 ? '' : 's'}?`,
      message: `They’re deleted for good and leave the slideshow and the guest form.${inAlbum ? ` ${inAlbum} of them ${inAlbum === 1 ? 'is' : 'are'} also in the photo album and will leave it too.` : ''}`,
      confirmLabel: 'Delete all',
      danger: true,
    })
    if (ok) clearAll.mutate()
  }
  const slideshowFull = (media.data ?? []).filter((m) => m.inHeroSlideshow).length >= MAX_SLIDESHOW
  function moveImage(index: number, by: number) {
    if (!media.data) return
    const ids = media.data.map((m) => m.id)
    const other = index + by
    if (other < 0 || other >= ids.length) return
    ;[ids[index], ids[other]] = [ids[other], ids[index]]
    reorder.mutate(ids)
  }

  async function uploadAll(files: File[]) {
    const images = files.filter(isImageFile)
    const skipped = files.filter((f) => !images.includes(f)).map((f) => ({ name: f.name, message: 'Not an image' }))
    setFailures(skipped)
    setLastBatch(null)
    if (!images.length) return
    setProgress({ done: 0, total: images.length })
    const failed: Array<{ name: string; message: string }> = [...skipped]
    for (const [i, file] of images.entries()) {
      const data = new FormData()
      try {
        data.append('image', await prepareImage(file))
        data.append('takenAt', await captureTimeOf(file))
        data.append('rightsConfirmed', 'true')
        await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/media`, data)
      } catch (e) {
        failed.push({ name: file.name, message: e instanceof ApiError || e instanceof Error ? e.message : 'Upload failed' })
      }
      setProgress({ done: i + 1, total: images.length })
      // Show new images as they arrive rather than only at the end.
      void queryClient.invalidateQueries({ queryKey: key })
    }
    setFailures(failed)
    setLastBatch(images.length - (failed.length - skipped.length))
    setProgress(null)
  }
  const uploading = progress !== null
  const selected = media.data?.find((m) => m.id === selectedId) ?? media.data?.[0]

  return (
    <section className="card site-setup-panel" aria-labelledby="lib-title">
      <h2 id="lib-title">Retreat images</h2>
      <p className="muted">Add photos for the public slideshow. Every photo in that slideshow also appears beside the guest’s review form. Photos may also be included in the album.</p>
      <p className="site-consent-note"><span aria-hidden="true">✓</span> By uploading, you confirm you have permission to use these photos and that people pictured have agreed.</p>
      <SlideshowSettings orgSlug={orgSlug} retreat={retreat} media={media.data ?? []} />
      {(media.data ?? []).some((m) => !m.rightsConfirmed) && (
        <p className="row small" style={{ margin: '0 0 1rem' }}>
          <span className="muted">{(media.data ?? []).filter((m) => !m.rightsConfirmed).length} image(s) still need your permission before they can show.</span>
          <button
            type="button"
            className="btn secondary small"
            onClick={async () => {
              const pending = (media.data ?? []).filter((m) => !m.rightsConfirmed)
              const ok = await confirm({
                title: `Do you have permission to use all ${pending.length} of these images?`,
                message: 'For example, you took them, or the photographer and anyone pictured agreed. They can then appear on your public page.',
                confirmLabel: 'Yes, I have permission',
              })
              if (!ok) return
              void Promise.all(pending.map((m) => patch(`${orgApi(orgSlug)}/media/${m.id}`, { rightsConfirmed: true }))).then(() =>
                queryClient.invalidateQueries({ queryKey: key }),
              )
            }}
          >
            I have permission for all of them
          </button>
        </p>
      )}
      <UploadZone
        id="lib-upload"
        title="Add photos"
        hint={`JPG, PNG, WebP or HEIC · up to ${MAX_UPLOAD_MB} MB each · location and camera details removed; only the time taken is kept`}
        accept={IMAGE_ACCEPT}
        busy={uploading}
        busyLabel={progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : undefined}
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
      {lastBatch !== null && lastBatch > 0 && (
        <p className="notice ok small" role="status" style={{ marginTop: '0.75rem' }}>
          {lastBatch} image{lastBatch === 1 ? '' : 's'} added and ready to show.
        </p>
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
      {media.isLoading && <Loading />}
      {media.error && <ErrorNotice error={media.error} />}
      {media.data && media.data.length === 0 && <p className="muted">No photos yet. Add some above to start your slideshow and provide images beside the guest form.</p>}
      {media.data && media.data.length > 0 && (
        <div className="site-image-workspace">
          <div className="site-image-list" role="group" aria-label="Retreat photos">
            {media.data.map((m, i) => (
              <div key={m.id} className={`site-image-row ${selected?.id === m.id ? 'is-active' : ''}`}>
                <button type="button" className="site-image-select" onClick={() => setSelectedId(m.id)} aria-pressed={selected?.id === m.id}>
                  <img src={thumb(m.previewUrl)} alt="" loading="lazy" />
                  <span><strong>{m.caption || `Photo ${i + 1}`}</strong><small>{m.approved ? m.inHeroSlideshow ? 'Public slideshow · guest form' : 'Ready, not in slideshow' : 'Confirm permission to show'}</small></span>
                </button>
                <div className="site-image-order">
                  <button type="button" className="btn ghost small" disabled={i === 0 || reorder.isPending} onClick={() => moveImage(i, -1)} aria-label={`Move ${m.caption || `photo ${i + 1}`} earlier`}>↑ Earlier</button>
                  <button type="button" className="btn ghost small" disabled={i === media.data!.length - 1 || reorder.isPending} onClick={() => moveImage(i, 1)} aria-label={`Move ${m.caption || `photo ${i + 1}`} later`}>↓ Later</button>
                </div>
              </div>
            ))}
            <span className="small muted" aria-live="polite">{reorder.isPending ? 'Saving order…' : reorder.isSuccess ? 'Order saved' : null}</span>
            <button type="button" className="btn ghost small danger-text" disabled={clearAll.isPending} onClick={() => void confirmClearAll()} style={{ justifySelf: 'start' }}>
              Delete all images
            </button>
            <MutationError error={reorder.error || clearAll.error} />
          </div>
          {selected && <MediaEditor key={selected.id} orgSlug={orgSlug} media={selected} slideshowFull={slideshowFull} onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: key })
            void queryClient.invalidateQueries({ queryKey: ['admin', orgSlug, 'album', retreat.id] })
          }} />}
        </div>
      )}
    </section>
  )
}
