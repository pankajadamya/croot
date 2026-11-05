import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get, orgApi, post } from '../../../lib/api'
import { ErrorNotice, Loading } from '../../../components/States'
import { BRAND_PALETTES, BRAND_PALETTE_KEYS, brandAsset, isBrandPaletteKey, type BrandPaletteKey } from '../../../lib/brand'
import { FORMAT_SIZE, renderSlide, type ShareFormat, type Slide } from '../../../lib/shareRender'
import type { Retreat } from '../types'

interface KitPhoto {
  id: string
  url: string
  alt: string
}
interface KitStory {
  id: string
  name: string | null
  title: string | null
  rating: number | null
  sentences: string[]
  photos: KitPhoto[]
}
interface KitData {
  retreat: { title: string; organiserName: string; slug: string }
  orgName: string
  brandThemeKey: string
  publicPath: string
  rating: { average: number; count: number } | null
  stories: KitStory[]
  retreatPhotos: KitPhoto[]
}
interface Choice {
  on: boolean
  /** Sentence range [from, to] of the guest's words: quotes are always verbatim. */
  from: number
  to: number
  photoId: string | null
}

const MAX_QUOTE = 280

/** Quote options: each sentence, and runs of following sentences while they stay short enough. */
function quoteOptions(sentences: string[]) {
  const out: Array<{ from: number; to: number; text: string }> = []
  sentences.forEach((_, i) => {
    let text = ''
    for (let j = i; j < sentences.length; j++) {
      text = text ? `${text} ${sentences[j]}` : sentences[j]
      if (text.length > MAX_QUOTE && j > i) break
      out.push({ from: i, to: j, text })
      if (text.length > MAX_QUOTE * 0.6) break
    }
  })
  return out
}

function defaultChoice(s: KitStory, index: number, retreatPhotos: KitPhoto[]): Choice {
  const opts = quoteOptions(s.sentences)
  const best = opts.filter((o) => o.from === 0).pop() ?? opts[0]
  return {
    on: index < 3,
    from: best?.from ?? 0,
    to: best?.to ?? 0,
    photoId: s.photos[0]?.id ?? retreatPhotos[(index + 1) % Math.max(retreatPhotos.length, 1)]?.id ?? null,
  }
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'croot'
}

/**
 * Share kit: ready-to-post images for Instagram, Facebook and TikTok, from guest reviews and photos.
 * Drawn in the browser; nothing is posted anywhere by Croot. Only guests who agreed to social-media use.
 */
export function ShareKitTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}/share-kit`
  const q = useQuery({ queryKey: ['admin', orgSlug, 'share-kit', retreat.id], queryFn: () => get<KitData>(base) })
  const [format, setFormat] = useState<ShareFormat>('post')
  const [brandPalette, setBrandPalette] = useState<BrandPaletteKey | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [withCover, setWithCover] = useState(true)
  const [withClosing, setWithClosing] = useState(true)
  const [coverPhoto, setCoverPhoto] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Array<{ url: string; blob: Blob; name: string }>>([])
  const [rendering, setRendering] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const renderRun = useRef(0)

  const d = q.data
  const selectedBrandPalette = brandPalette ?? (d && isBrandPaletteKey(d.brandThemeKey) ? d.brandThemeKey : 'forest-linen')
  useEffect(() => {
    if (!d) return
    setChoices((prev) => {
      const next = { ...prev }
      d.stories.forEach((s, i) => {
        if (!next[s.id]) next[s.id] = defaultChoice(s, i, d.retreatPhotos)
      })
      return next
    })
    setCoverPhoto((c) => c ?? d.retreatPhotos[0]?.id ?? d.stories.find((s) => s.photos.length)?.photos[0].id ?? null)
  }, [d])

  const photoUrl = useMemo(() => {
    const map = new Map<string, string>()
    d?.retreatPhotos.forEach((p) => map.set(p.id, p.url))
    d?.stories.forEach((s) => s.photos.forEach((p) => map.set(p.id, p.url)))
    return (id: string | null) => (id ? (map.get(id) ?? null) : null)
  }, [d])

  const chosen = (d?.stories ?? []).filter((s) => choices[s.id]?.on)
  const link = d ? `${window.location.origin}${d.publicPath}` : ''
  const quoteOf = (s: KitStory) => {
    const c = choices[s.id]
    return s.sentences.slice(c.from, c.to + 1).join(' ')
  }

  const slides: Slide[] = useMemo(() => {
    if (!d) return []
    const brand = d.retreat.organiserName || d.orgName
    const list: Slide[] = []
    if (withCover) list.push({ kind: 'cover', photoUrl: photoUrl(coverPhoto), heading: 'What our guests say', title: d.retreat.title, rating: d.rating, brand })
    for (const s of chosen) {
      list.push({ kind: 'review', photoUrl: photoUrl(choices[s.id].photoId), quote: quoteOf(s), title: s.title, name: s.name, rating: s.rating, retreatTitle: d.retreat.title, brand })
    }
    if (withClosing) list.push({ kind: 'closing', photoUrl: photoUrl(coverPhoto), title: d.retreat.title, link: link.replace(/^https?:\/\//, ''), brand })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, choices, withCover, withClosing, coverPhoto, photoUrl, link])

  // Re-draw the slides (debounced) whenever the choices change.
  useEffect(() => {
    if (!slides.length) {
      setPreviews([])
      return
    }
    const run = ++renderRun.current
    setRendering(true)
    const t = window.setTimeout(async () => {
      try {
        const blobs = await Promise.all(slides.map((s) => renderSlide(s, format, selectedBrandPalette)))
        if (run !== renderRun.current) return
        setPreviews((old) => {
          old.forEach((p) => URL.revokeObjectURL(p.url))
          return blobs.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), name: `${slug(d!.retreat.title)}-${format}-${String(i + 1).padStart(2, '0')}.jpg` }))
        })
      } catch (e) {
        if (run === renderRun.current) setStatus((e as Error).message)
      } finally {
        if (run === renderRun.current) setRendering(false)
      }
    }, 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, format, selectedBrandPalette])

  const suggestedCaption = useMemo(() => {
    if (!d) return ''
    const first = chosen[0]
    const quote = first ? `“${quoteOf(first)}”${first.name ? ` — ${first.name}` : ''}\n\n` : ''
    const stars = d.rating ? ` ${'★'.repeat(Math.round(d.rating.average))} ${d.rating.average.toFixed(1)} from ${d.rating.count} guest review${d.rating.count === 1 ? '' : 's'}.` : ''
    const tags = ['#retreat', '#yogaretreat', '#wellness', `#${slug(d.orgName).replace(/-/g, '')}`].join(' ')
    return `${quote}What our guests said about ${d.retreat.title}.${stars}\n\nRead more guest stories: ${link}\n\n${tags}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, choices, link])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorNotice error={q.error} />
  if (!d) return null

  const files = previews.map((p) => new File([p.blob], p.name, { type: 'image/jpeg' }))
  const canShareFiles = typeof navigator !== 'undefined' && Boolean(navigator.canShare?.({ files: files.slice(0, 1) }))

  async function logUse() {
    await post(`${base}/used`, { storyIds: chosen.map((s) => s.id), format }).catch(() => {})
  }
  async function share() {
    setStatus(null)
    try {
      await navigator.share({ files, text: caption ?? suggestedCaption, title: d!.retreat.title })
      void logUse()
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setStatus('Sharing didn’t work here. Download the images instead.')
    }
  }
  async function downloadAll() {
    for (const p of previews) {
      const a = document.createElement('a')
      a.href = p.url
      a.download = p.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      await new Promise((r) => setTimeout(r, 300))
    }
    setStatus(`Downloaded ${previews.length} image${previews.length === 1 ? '' : 's'}.`)
    void logUse()
  }
  async function copyCaption() {
    await navigator.clipboard.writeText(caption ?? suggestedCaption).then(
      () => setStatus('Caption copied.'),
      () => setStatus('Select the caption and copy it.'),
    )
  }

  const update = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }))

  return (
    <div className="stack">
      <div className="panel-sage">
        <h2 style={{ marginTop: 0 }}>Share kit</h2>
        <p className="small" style={{ marginBottom: 0 }}>
          Ready-made images for Instagram, Facebook and TikTok, from your guests’ own words, stars and photos. Only guests who agreed to their story
          being reused in social media are listed, with their first name only if they allowed it. Quotes are always their exact sentences. Croot
          doesn’t post anything: share from your phone or download the images.
        </p>
      </div>

      <fieldset className="card tight">
        <legend style={{ fontWeight: 700 }}>Croot logo on each image</legend>
        <p className="small muted">Each exported slide includes the 09F symbol and croot name. The colourway starts with this retreat’s published theme; you can choose another below.</p>
        <label htmlFor="kit-brand-palette" style={{ fontWeight: 600 }}>Logo colourway</label>
        <select id="kit-brand-palette" value={selectedBrandPalette} onChange={(e) => setBrandPalette(e.target.value as BrandPaletteKey)}>
          {BRAND_PALETTE_KEYS.map((key) => <option key={key} value={key}>{BRAND_PALETTES[key].label}</option>)}
        </select>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginTop: '0.9rem' }}>
          <a className="card tight" href={brandAsset('mark', selectedBrandPalette)} download style={{ background: BRAND_PALETTES[selectedBrandPalette].preview, textDecoration: 'none' }}>
            <img src={brandAsset('mark', selectedBrandPalette)} alt="Croot symbol" style={{ width: 92, height: 92, margin: '0 auto 0.5rem' }} />
            <span className="small" style={{ display: 'block', textAlign: 'center' }}>Download logo alone</span>
          </a>
          <a className="card tight" href={brandAsset('logo', selectedBrandPalette)} download style={{ background: BRAND_PALETTES[selectedBrandPalette].preview, textDecoration: 'none' }}>
            <img src={brandAsset('logo', selectedBrandPalette)} alt="Croot logo with name" style={{ width: 150, height: 92, margin: '0 auto 0.5rem', objectFit: 'contain' }} />
            <span className="small" style={{ display: 'block', textAlign: 'center' }}>Download logo with name</span>
          </a>
        </div>
      </fieldset>

      {d.stories.length === 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No stories can be used yet</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            A story appears here once its guest has sent it and agreed to “reuse my story or photos in social media or advertising”.
          </p>
        </div>
      ) : (
        <div className="kit-layout">
          <div className="stack">
            <fieldset className="card tight kit-format">
              <legend>Format</legend>
              {(Object.keys(FORMAT_SIZE) as ShareFormat[]).map((f) => (
                <label key={f} className="kit-radio">
                  <input type="radio" name="kit-format" checked={format === f} onChange={() => setFormat(f)} />
                  <span>{FORMAT_SIZE[f].label}</span>
                </label>
              ))}
              <label className="kit-radio">
                <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} />
                <span>Start with a title slide{d.rating ? ' (with your star rating)' : ''}</span>
              </label>
              <label className="kit-radio">
                <input type="checkbox" checked={withClosing} onChange={(e) => setWithClosing(e.target.checked)} />
                <span>End with a “read more” slide and your link</span>
              </label>
              {(withCover || withClosing) && d.retreatPhotos.length > 0 && (
                <PhotoPicker label="Photo for the title and closing slides" photos={d.retreatPhotos} value={coverPhoto} onChange={setCoverPhoto} />
              )}
            </fieldset>

            {d.stories.map((s) => {
              const c = choices[s.id]
              if (!c) return null
              const opts = quoteOptions(s.sentences)
              return (
                <div key={s.id} className={`card tight kit-story ${c.on ? 'on' : ''}`}>
                  <label className="kit-radio" style={{ fontWeight: 700 }}>
                    <input type="checkbox" checked={c.on} onChange={(e) => update(s.id, { on: e.target.checked })} />
                    <span>
                      {s.name ?? 'A guest (no name)'}
                      {s.title ? ` · ${s.title}` : ''}
                      {s.rating ? ` · ${'★'.repeat(s.rating)}` : ''}
                    </span>
                  </label>
                  {c.on && (
                    <>
                      <label className="small" htmlFor={`q-${s.id}`} style={{ fontWeight: 600, display: 'block', margin: '0.6rem 0 0.25rem' }}>
                        Quote (their exact words)
                      </label>
                      <select
                        id={`q-${s.id}`}
                        value={`${c.from}-${c.to}`}
                        onChange={(e) => {
                          const [from, to] = e.target.value.split('-').map(Number)
                          update(s.id, { from, to })
                        }}
                      >
                        {opts.map((o) => (
                          <option key={`${o.from}-${o.to}`} value={`${o.from}-${o.to}`}>
                            {o.text.length > 110 ? `${o.text.slice(0, 110)}…` : o.text}
                          </option>
                        ))}
                      </select>
                      <PhotoPicker
                        label="Photo"
                        photos={[...s.photos, ...d.retreatPhotos]}
                        guestCount={s.photos.length}
                        value={c.photoId}
                        onChange={(id) => update(s.id, { photoId: id })}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <div className="stack kit-output">
            <div className="spread">
              <h3 style={{ margin: 0 }}>
                {previews.length} image{previews.length === 1 ? '' : 's'}
              </h3>
              <span className="small muted" aria-live="polite">
                {rendering ? 'Drawing…' : FORMAT_SIZE[format].w + ' × ' + FORMAT_SIZE[format].h}
              </span>
            </div>
            <div className={`kit-previews ${format}`}>
              {previews.map((p, i) => (
                <button key={p.url} type="button" className="kit-preview" onClick={() => setZoom(i)} aria-label={`View slide ${i + 1} larger`}>
                  <img src={p.url} alt={`Slide ${i + 1}`} />
                </button>
              ))}
            </div>
            {zoom !== null && previews[zoom] && (
              <SlideViewer previews={previews} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />
            )}
            <div className="row">
              {canShareFiles && (
                <button type="button" className="btn" disabled={!previews.length || rendering} onClick={() => void share()}>
                  Share…
                </button>
              )}
              <button type="button" className={canShareFiles ? 'btn secondary' : 'btn'} disabled={!previews.length || rendering} onClick={() => void downloadAll()}>
                Download all
              </button>
            </div>
            <label htmlFor="kit-caption" style={{ fontWeight: 600 }}>
              Caption
            </label>
            <textarea id="kit-caption" value={caption ?? suggestedCaption} onChange={(e) => setCaption(e.target.value)} style={{ minHeight: '11rem' }} />
            <div className="row">
              <button type="button" className="btn secondary small" onClick={() => void copyCaption()}>
                Copy caption
              </button>
              {caption !== null && (
                <button type="button" className="btn ghost small" onClick={() => setCaption(null)}>
                  Use the suggested caption
                </button>
              )}
            </div>
            <p className="small muted" aria-live="polite" style={{ margin: 0 }}>
              {status}
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              On a phone, Share opens your apps (Instagram, Facebook, TikTok…) with the images attached. On a computer, download them and upload as a
              post or carousel. Paste the caption with them.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoPicker({
  label,
  photos,
  value,
  onChange,
  guestCount = 0,
}: {
  label: string
  photos: KitPhoto[]
  value: string | null
  onChange: (id: string | null) => void
  guestCount?: number
}) {
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <span className="small" style={{ fontWeight: 600 }}>
        {label}
      </span>
      <div className="kit-photos" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={value === null} className={`kit-photo none ${value === null ? 'on' : ''}`} onClick={() => onChange(null)}>
          None
        </button>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={value === p.id}
            className={`kit-photo ${value === p.id ? 'on' : ''}`}
            onClick={() => onChange(p.id)}
            title={i < guestCount ? 'The guest’s photo' : 'Your photo'}
          >
            <img src={p.url} alt={p.alt} loading="lazy" />
            {i < guestCount && <span className="kit-photo-tag">Guest</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A slide at full size: arrow keys or the side buttons move between slides; Esc closes. */
function SlideViewer({
  previews,
  index,
  onIndex,
  onClose,
}: {
  previews: Array<{ url: string; name: string }>
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const count = previews.length
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onIndex((index + 1) % count)
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + count) % count)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, count, onIndex, onClose])
  const p = previews[index]
  return (
    <div className="kit-viewer" role="dialog" aria-modal="true" aria-label={`Slide ${index + 1} of ${count}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <img src={p.url} alt={`Slide ${index + 1} of ${count}`} />
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {count > 1 && (
        <>
          <button type="button" className="lightbox-edge left" onClick={() => onIndex((index - 1 + count) % count)} aria-label="Previous slide">
            ‹
          </button>
          <button type="button" className="lightbox-edge right" onClick={() => onIndex((index + 1) % count)} aria-label="Next slide">
            ›
          </button>
        </>
      )}
      <div className="kit-viewer-bar">
        <span>
          {index + 1} / {count}
        </span>
        <a className="btn secondary small" href={p.url} download={p.name}>
          Download this image
        </a>
      </div>
    </div>
  )
}
