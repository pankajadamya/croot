import { useState, type FormEvent } from 'react'
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
import { SlideshowSettings } from './SlideshowSettings'

interface ContentState {
  draft: ContentRevision | null
  published: ContentRevision | null
}

export function SiteTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const content = useQuery({
    queryKey: ['admin', orgSlug, 'content', retreat.id],
    queryFn: () => get<ContentState>(`${orgApi(orgSlug)}/retreats/${retreat.id}/content`),
  })
  return (
    <div className="stack">
      {content.isLoading && <Loading />}
      {content.error && <ErrorNotice error={content.error} />}
      {content.data && <OpeningEditor key={content.data.draft?.id ?? 'new'} orgSlug={orgSlug} retreat={retreat} state={content.data} />}
      <VisitorSettings orgSlug={orgSlug} retreat={retreat} />
      <ImageLibrary orgSlug={orgSlug} retreat={retreat} />
      {retreat.kind === 'itinerary' && <AlbumSection orgSlug={orgSlug} retreat={retreat} />}
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

  return (
    <section className="card" aria-labelledby="opening-title">
      <div className="spread">
        <h2 id="opening-title" style={{ margin: 0 }}>
          Your opening
        </h2>
        <span className={`badge ${pub ? (scheduled ? 'warn' : 'ok') : 'neutral'}`}>
          {pub ? (scheduled ? `Scheduled for ${formatDateTime(pub.publishAt)}` : `Live since ${formatDateTime(pub.publishAt ?? pub.createdAt)}`) : 'Not published'}
        </span>
      </div>
      <p className="small muted">The headline and introduction visitors see first, in your own words. Publishing or unpublishing this never affects guest stories.</p>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form onSubmit={submit} noValidate>
          <Field id="op-headline" label="Headline" error={fieldError(error, 'headline')}>
            <input id="op-headline" type="text" maxLength={160} value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </Field>
          {paragraphs.map((p, i) => (
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
          <div className="grid-2">
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
              Publish now
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
          <div className="row" style={{ alignItems: 'flex-end', marginTop: '1rem' }}>
            <div className="field" style={{ marginBottom: 0, flex: '1 1 200px' }}>
              <label htmlFor="op-when">Schedule for later</label>
              <input id="op-when" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} min={toLocalInput(new Date().toISOString())} />
            </div>
            <button type="button" className="btn secondary" disabled={!publishAt || publish.isPending || !headline.trim()} onClick={() => publish.mutate(fromLocalInput(publishAt))}>
              Schedule
            </button>
          </div>
        </form>

        <div>
          <p className="eyebrow">Preview</p>
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
  const queryClient = useQueryClient()
  const key = ['admin', orgSlug, 'media', retreat.id]
  const media = useQuery({ queryKey: key, queryFn: () => get<{ media: OrganiserMedia[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/media`).then((r) => r.media) })
  // Several files at once: uploaded one after another, so progress is clear and one bad file
  // (wrong type, too large) doesn't stop the rest.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([])
  const [dragging, setDragging] = useState(false)
  const [lastBatch, setLastBatch] = useState<number | null>(null)

  async function uploadAll(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name))
    const skipped = files.filter((f) => !images.includes(f)).map((f) => ({ name: f.name, message: 'Not an image' }))
    setFailures(skipped)
    setLastBatch(null)
    if (!images.length) return
    setProgress({ done: 0, total: images.length })
    const failed: Array<{ name: string; message: string }> = [...skipped]
    for (const [i, file] of images.entries()) {
      const data = new FormData()
      data.append('image', file)
      try {
        await post(`${orgApi(orgSlug)}/retreats/${retreat.id}/media`, data)
      } catch (e) {
        failed.push({ name: file.name, message: e instanceof ApiError ? e.message : 'Upload failed' })
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

  return (
    <section className="card" aria-labelledby="lib-title">
      <h2 id="lib-title">Your images</h2>
      <p className="small muted">
        Images you provide for the public slideshow and the optional memory prompts beside the guest’s writing form. An image can be shown once you’ve confirmed you have permission to
        use it. Alt text is optional but helps guests who use screen readers. Guest photos are managed from each response instead.
      </p>
      <SlideshowSettings orgSlug={orgSlug} retreat={retreat} media={media.data ?? []} />
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!uploading) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!uploading) void uploadAll(Array.from(e.dataTransfer.files))
        }}
      >
        <label htmlFor="lib-upload" style={{ fontWeight: 600 }}>
          Upload images
        </label>
        <span className="hint" id="lib-upload-hint">
          Choose several at once, or drag them here. JPEG, PNG or WebP. Location and camera details are removed.
        </span>
        <input
          id="lib-upload"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="lib-upload-hint"
          disabled={uploading}
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
      {lastBatch !== null && lastBatch > 0 && (
        <p className="notice ok small" role="status" style={{ marginTop: '0.75rem' }}>
          {lastBatch} image{lastBatch === 1 ? '' : 's'} uploaded. Confirm you have permission to show {lastBatch === 1 ? 'it' : 'them'}.
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
      {media.data && media.data.length === 0 && <p className="muted">No images yet.</p>}
      {media.data && media.data.length > 0 && (
        <ul className="media-grid" style={{ listStyle: 'none', padding: 0 }}>
          {media.data.map((m) => (
            <li key={m.id}>
              <MediaEditor orgSlug={orgSlug} media={m} onChanged={() => queryClient.invalidateQueries({ queryKey: key })} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
