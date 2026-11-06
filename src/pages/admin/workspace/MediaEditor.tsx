import { useCallback, useEffect, useRef, useState } from 'react'
import { SaveIndicator } from '../../../components/SaveIndicator'
import { useMutation } from '@tanstack/react-query'
import { del, orgApi, patch } from '../../../lib/api'
import { Field } from '../../../components/Controls'
import { fieldError, MutationError } from '../adminUi'
import type { OrganiserMedia } from '../types'
import { imageStatus } from './SlideshowSettings'
import { useConfirm } from '../../../components/ConfirmDialog'

type Fields = {
  altText: string
  caption: string
  credit: string
  inHeroSlideshow: boolean
  inAlbum: boolean
}
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const TYPING_PAUSE_MS = 800

/**
 * One organiser image. Everything saves automatically: switches at once, text shortly after typing
 * stops (or when the field loses focus). Saves never overlap, and the latest values always win.
 */
export function MediaEditor({ orgSlug, media, onChanged }: { orgSlug: string; media: OrganiserMedia; onChanged: () => void }) {
  const confirm = useConfirm()
  const id = media.id
  const [f, setF] = useState<Fields>({
    altText: media.altText,
    caption: media.caption,
    credit: media.credit,
    inHeroSlideshow: media.inHeroSlideshow,
    inAlbum: Boolean(media.inAlbum),
  })
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<unknown>(null)
  const latest = useRef(f)
  const dirty = useRef(false)
  const inFlight = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current || inFlight.current) return
    dirty.current = false
    inFlight.current = true
    setState('saving')
    let ok = false
    try {
      const v = latest.current
      await patch(`${orgApi(orgSlug)}/media/${id}`, v)
      ok = true
      setError(null)
      setState(dirty.current ? 'saving' : 'saved')
      onChanged()
    } catch (e) {
      dirty.current = true
      setError(e)
      setState('error')
    } finally {
      inFlight.current = false
    }
    // Changes made while that save was running go out now (after a failure, Retry does it).
    if (ok && dirty.current) void flush()
  }, [id, orgSlug, onChanged])

  // Save anything pending if the editor goes away (e.g. switching tabs).
  useEffect(() => () => void flush(), [flush])

  function change<K extends keyof Fields>(k: K, v: Fields[K], immediate: boolean) {
    const next = { ...latest.current, [k]: v }
    latest.current = next
    setF(next)
    dirty.current = true
    window.clearTimeout(timer.current)
    if (immediate) void flush()
    else timer.current = window.setTimeout(() => void flush(), TYPING_PAUSE_MS)
  }

  const remove = useMutation({ mutationFn: () => del(`${orgApi(orgSlug)}/media/${id}`), onSuccess: onChanged })
  const confirmRights = useMutation({ mutationFn: () => patch(`${orgApi(orgSlug)}/media/${id}`, { rightsConfirmed: true }), onSuccess: onChanged })
  const text = (k: 'altText' | 'caption' | 'credit') => ({
    value: f[k],
    onChange: (e: { target: { value: string } }) => change(k, e.target.value, false),
    onBlur: () => void flush(),
  })

  return (
    <div className="site-photo-details">
      <h3>Photo details</h3>
      <img className="site-photo-details-preview" src={media.previewUrl} alt={f.altText || f.caption || 'Retreat photo'} loading="lazy" />
      <div className="spread small" style={{ margin: '0.5rem 0' }}>
        <span className={`badge ${media.approved ? 'ok' : 'warn'}`}>{imageStatus(media)}</span>
        <span className="row" style={{ gap: '0.4rem' }}>
          {state === 'error' && (
            <button type="button" className="btn ghost small" onClick={() => void flush()}>
              Retry
            </button>
          )}
          <SaveIndicator state={state} />
        </span>
      </div>
      <Field
        id={`alt-${id}`}
        label="Alt text (optional)"
        hint="Describe the image for people who can’t see it. If left empty, the caption is used, or “Retreat photo”."
        error={fieldError(error, 'altText')}
      >
        <input id={`alt-${id}`} type="text" maxLength={300} aria-describedby={`alt-${id}-hint`} {...text('altText')} />
      </Field>
      <Field id={`cap-${id}`} label="Caption" error={fieldError(error, 'caption')}>
        <input id={`cap-${id}`} type="text" maxLength={300} {...text('caption')} />
      </Field>
      <Field id={`cred-${id}`} label="Credit" hint="Photographer or source" error={fieldError(error, 'credit')}>
        <input id={`cred-${id}`} type="text" {...text('credit')} />
      </Field>
      <fieldset className="site-photo-placements">
        <legend>Appears in</legend>
        <p className="small muted">Choose where this photo appears. These are placement choices, not permission settings.</p>
        <label><input type="checkbox" checked={f.inHeroSlideshow} onChange={(e) => change('inHeroSlideshow', e.target.checked, true)} /> Public slideshow and guest review form</label>
        <label><input type="checkbox" checked={f.inAlbum} onChange={(e) => change('inAlbum', e.target.checked, true)} /> Photo album</label>
      </fieldset>
      {!media.rightsConfirmed && (
        <div className="notice warn small">
          This older image is hidden until you confirm permission to use it.
          <button type="button" className="btn secondary small" disabled={confirmRights.isPending} onClick={() => void confirm({ title: 'Confirm permission for this photo?', message: 'Confirm that you have permission to use this photo and that people pictured agreed.', confirmLabel: 'Confirm permission' }).then((ok) => ok && confirmRights.mutate())}>Confirm permission</button>
        </div>
      )}
      <MutationError error={state === 'error' ? error : remove.error || confirmRights.error} shownFields={['altText', 'caption', 'credit']} />
      <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
        <button
          type="button"
          className="btn ghost small"
          disabled={remove.isPending}
          onClick={() => {
            void confirm({ title: 'Delete this image?', message: 'It’s also removed from any slideshow.', confirmLabel: 'Delete image', danger: true }).then((ok) => ok && remove.mutate())
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
