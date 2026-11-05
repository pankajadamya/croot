import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, orgApi, patch, post, put } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { Field, Switch } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { ThemeScope } from '../../../components/ThemeScope'
import { fieldError, fromLocalInput, MutationError, toLocalInput } from '../adminUi'
import type { ContentRevision, OrganiserMedia, Retreat } from '../types'
import { useRetreatTheme } from './AppearanceTab'

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
      <ImageLibrary orgSlug={orgSlug} retreat={retreat} />
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
                  if (window.confirm('Unpublish your opening? Guest stories stay published.')) unpublish.mutate()
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

function ImageLibrary({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const queryClient = useQueryClient()
  const key = ['admin', orgSlug, 'media', retreat.id]
  const media = useQuery({ queryKey: key, queryFn: () => get<{ media: OrganiserMedia[] }>(`${orgApi(orgSlug)}/retreats/${retreat.id}/media`).then((r) => r.media) })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData()
      data.append('image', file)
      return post(`${orgApi(orgSlug)}/retreats/${retreat.id}/media`, data)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return (
    <section className="card" aria-labelledby="lib-title">
      <h2 id="lib-title">Your images</h2>
      <p className="small muted">
        Images you provide for the public slideshow and the optional memory prompts beside the guest’s writing form. An image can be shown only once it has alt text and you’ve
        confirmed you have permission to use it. Guest photos are managed from each response instead.
      </p>
      <div className="field">
        <label htmlFor="lib-upload">Upload an image</label>
        <span className="hint" id="lib-upload-hint">
          JPEG, PNG or WebP. Location and camera details are removed.
        </span>
        <input
          id="lib-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="lib-upload-hint"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate(file)
            e.target.value = ''
          }}
        />
      </div>
      {upload.isPending && <p role="status">Uploading…</p>}
      <MutationError error={upload.error} />
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

function MediaEditor({ orgSlug, media, onChanged }: { orgSlug: string; media: OrganiserMedia; onChanged: () => void }) {
  const [f, setF] = useState({
    altText: media.altText,
    caption: media.caption,
    credit: media.credit,
    rightsConfirmed: media.rightsConfirmed,
    displayOrder: String(media.displayOrder),
    inHeroSlideshow: media.inHeroSlideshow,
    inWritingSlideshow: media.inWritingSlideshow,
  })
  const [saved, setSaved] = useState(false)
  const id = media.id
  const save = useMutation({
    mutationFn: () => patch(`${orgApi(orgSlug)}/media/${id}`, { ...f, displayOrder: Number(f.displayOrder) || 0 }),
    onSuccess: () => {
      setSaved(true)
      onChanged()
    },
  })
  const remove = useMutation({ mutationFn: () => del(`${orgApi(orgSlug)}/media/${id}`), onSuccess: onChanged })
  const set = (k: keyof typeof f) => (v: string | boolean) => {
    setSaved(false)
    setF((x) => ({ ...x, [k]: v }))
  }
  const ready = f.rightsConfirmed && f.altText.trim().length > 0

  return (
    <div className="card tight">
      <img src={media.previewUrl} alt={media.altText || 'Image without alt text yet'} loading="lazy" />
      <div className="row small" style={{ margin: '0.5rem 0' }}>
        <span className={`badge ${media.approved ? 'ok' : 'warn'}`}>{media.approved ? 'Ready to show' : 'Needs alt text and permission'}</span>
      </div>
      <Field id={`alt-${id}`} label="Alt text" hint="Describe the image for people who can’t see it." error={fieldError(save.error, 'altText')}>
        <input id={`alt-${id}`} type="text" value={f.altText} onChange={(e) => set('altText')(e.target.value)} aria-describedby={`alt-${id}-hint`} />
      </Field>
      <Field id={`cap-${id}`} label="Caption" error={fieldError(save.error, 'caption')}>
        <input id={`cap-${id}`} type="text" value={f.caption} onChange={(e) => set('caption')(e.target.value)} />
      </Field>
      <Field id={`cred-${id}`} label="Credit" hint="Photographer or source" error={fieldError(save.error, 'credit')}>
        <input id={`cred-${id}`} type="text" value={f.credit} onChange={(e) => set('credit')(e.target.value)} />
      </Field>
      <Field id={`ord-${id}`} label="Display order" hint="Lower numbers show first." error={fieldError(save.error, 'displayOrder')}>
        <input id={`ord-${id}`} type="number" min={0} max={1000} value={f.displayOrder} onChange={(e) => set('displayOrder')(e.target.value)} />
      </Field>
      <div className="stack">
        <Switch checked={f.rightsConfirmed} onChange={set('rightsConfirmed')} label="I have permission to publish this image" />
        <Switch checked={f.inHeroSlideshow} onChange={set('inHeroSlideshow')} label="Public slideshow" disabled={!ready && !f.inHeroSlideshow} />
        <Switch checked={f.inWritingSlideshow} onChange={set('inWritingSlideshow')} label="Writing-form memory prompts" disabled={!ready && !f.inWritingSlideshow} />
      </div>
      {!ready && <p className="small muted">Add alt text and confirm permission to use this image in a slideshow.</p>}
      <MutationError error={save.error || remove.error} shownFields={['altText', 'caption', 'credit', 'displayOrder']} />
      <div className="spread" style={{ marginTop: '0.75rem' }}>
        <div className="row">
          <button type="button" className="btn small" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <span aria-live="polite" className="small">
            {saved && 'Saved'}
          </span>
        </div>
        <button
          type="button"
          className="btn ghost small"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm('Delete this image? It will be removed from any slideshow.')) remove.mutate()
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
