import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orgApi, patch } from '../../../lib/api'
import { toDateInput } from '../../../lib/format'
import { slugify } from '../../../../shared/slug'
import { REVIEW_KINDS, type FeedbackCategory } from '../../../../shared/categories'
import { Field, Switch } from '../../../components/Controls'
import { fieldError, fromLocalInput, MutationError, orgKey, retreatKey, RETREAT_STATUS_LABELS, toLocalInput, useOrgSummary } from '../adminUi'
import type { Retreat, RetreatStats } from '../types'
import { useConfirm } from '../../../components/ConfirmDialog'

const STAT_LABELS: Array<[keyof RetreatStats, string]> = [
  ['attendees', 'Invited'],
  ['opened', 'Opened link'],
  ['drafts', 'Drafts'],
  ['submitted', 'Submitted'],
  ['published', 'Published'],
  ['anonymousNotes', 'Anonymous notes'],
]

export function OverviewTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const summary = useOrgSummary(orgSlug)
  const stats = summary.data?.retreats.find((r) => r.id === retreat.id)?.stats
  return (
    <div className="stack">
      {stats && (
        <section className="card" aria-labelledby="ov-stats">
          <h2 id="ov-stats">At a glance</h2>
          <dl className="stats">
            {STAT_LABELS.map(([key, label]) => (
              <div className="stat" key={key}>
                <dt className="small muted">{label}</dt>
                <dd style={{ margin: 0 }}>
                  <b>{stats[key]}</b>
                </dd>
              </div>
            ))}
          </dl>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Drafts are guests still writing; they never appear in the review queue until submitted.
          </p>
        </section>
      )}
      {/* Keyed by programme only: saving must not remount the form (that would lose typing and the "Saved" note). */}
      <SettingsForm key={retreat.id} orgSlug={orgSlug} retreat={retreat} />
    </div>
  )
}

type CategoryRow = FeedbackCategory & { isNew?: boolean }

function SettingsForm({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const isProperty = retreat.kind === 'property'
  const [f, setF] = useState(() => ({
    title: retreat.title,
    slug: retreat.slug,
    startDate: toDateInput(retreat.startDate),
    endDate: toDateInput(retreat.endDate),
    locationSummary: retreat.locationSummary,
    route: [0, 1, 2, 3].map((i) => retreat.routeSummary[i] ?? ''),
    amenities: [0, 1, 2, 3, 4, 5].map((i) => retreat.amenities?.[i] ?? ''),
    propertyAddress: retreat.propertyAddress ?? '',
    itineraryUrl: retreat.itineraryUrl ?? '',
    retreatPageUrl: retreat.retreatPageUrl ?? '',
    organiserName: retreat.organiserName,
    contactEmail: retreat.contactEmail ?? '',
    contactPhone: retreat.contactPhone ?? '',
    privacyUrl: retreat.privacyUrl ?? '',
    status: retreat.status,
    inviteOpensAt: toLocalInput(retreat.inviteOpensAt),
    inviteClosesAt: toLocalInput(retreat.inviteClosesAt),
    inviteTtlDays: String(retreat.inviteTtlDays),
    draftEditingEnabled: retreat.draftEditingEnabled,
    aggregateThreshold: String(retreat.aggregateThreshold),
  }))
  const [categories, setCategories] = useState<CategoryRow[]>(retreat.feedbackCategories)
  const [newCategory, setNewCategory] = useState('')
  // Everything here saves automatically, a moment after you stop typing. The web address is the one
  // exception: changing it breaks old links, so it saves only when you confirm.
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedSlug, setSavedSlug] = useState(retreat.slug)

  const text = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setSaved(false)
    if (k !== 'slug') setDirty(true)
    setF((x) => ({ ...x, [k]: e.target.value }))
  }
  const toggle = (k: keyof typeof f) => (v: boolean) => {
    setSaved(false)
    setDirty(true)
    setF((x) => ({ ...x, [k]: v }))
  }

  const save = useMutation({
    mutationFn: () =>
      patch<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats/${retreat.id}`, {
        title: f.title,
        ...(isProperty
          ? {
              propertyAddress: f.propertyAddress.trim() || null,
              amenities: f.amenities.map((a) => a.trim()).filter(Boolean),
            }
          : {
              startDate: f.startDate || null,
              endDate: f.endDate || null,
              routeSummary: f.route.map((r) => r.trim()).filter(Boolean),
              itineraryUrl: f.itineraryUrl.trim() || null,
            }),
        locationSummary: f.locationSummary,
        retreatPageUrl: f.retreatPageUrl.trim() || null,
        organiserName: f.organiserName,
        contactEmail: f.contactEmail.trim() || null,
        contactPhone: f.contactPhone.trim() || null,
        privacyUrl: f.privacyUrl.trim() || null,
        status: f.status,
        inviteOpensAt: fromLocalInput(f.inviteOpensAt),
        inviteClosesAt: fromLocalInput(f.inviteClosesAt),
        inviteTtlDays: Number(f.inviteTtlDays),
        draftEditingEnabled: f.draftEditingEnabled,
        aggregateThreshold: Number(f.aggregateThreshold),
        feedbackCategories: categories.map(({ key, label }) => ({ key, label: label.trim() })),
      }),
    onSuccess: ({ retreat: updated }) => {
      queryClient.setQueryData(retreatKey(orgSlug, retreat.id), updated)
      void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
      setSaved(true)
    },
  })

  const saveSlug = useMutation({
    mutationFn: (slug: string) => patch<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats/${retreat.id}`, { slug }),
    onSuccess: ({ retreat: updated }) => {
      queryClient.setQueryData(retreatKey(orgSlug, retreat.id), updated)
      void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
      setSavedSlug(updated.slug)
      setSaved(true)
    },
  })
  async function commitSlug() {
    const next = f.slug.trim()
    if (!next || next === savedSlug) return
    const ok = await confirm({
      title: `Change the web address to “${next}”?`,
      message: 'Links to the old address will stop working, including any you’ve already shared.',
      confirmLabel: 'Change address',
      danger: true,
    })
    if (!ok) {
      setF((x) => ({ ...x, slug: savedSlug }))
      return
    }
    saveSlug.mutate(next)
  }

  // Auto-save: a short pause after the last change.
  const latest = useRef(save)
  latest.current = save
  useEffect(() => {
    if (!dirty) return
    const t = window.setTimeout(() => {
      setDirty(false)
      latest.current.mutate()
    }, 900)
    return () => window.clearTimeout(t)
  }, [dirty, f, categories])

  // Don't let a closing tab lose a change that hasn't saved yet.
  useEffect(() => {
    if (!dirty && !save.isPending) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, save.isPending])

  const err = (k: string) => fieldError(save.error, k) ?? (k === 'slug' ? fieldError(saveSlug.error, k) : undefined)

  function addCategory() {
    const label = newCategory.trim()
    if (!label) return
    const base = slugify(label, 36) || 'category'
    let key = base
    for (let i = 2; categories.some((c) => c.key === key); i++) key = `${base}-${i}`
    setCategories((c) => [...c, { key, label, isNew: true }])
    setNewCategory('')
    setSaved(false)
    setDirty(true)
  }

  function move(index: number, delta: number) {
    setCategories((c) => {
      const next = [...c]
      const [item] = next.splice(index, 1)
      next.splice(index + delta, 0, item)
      return next
    })
    setSaved(false)
    setDirty(true)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setDirty(false)
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="stack">
      <section className="card" aria-labelledby="ov-details">
        <h2 id="ov-details">{isProperty ? 'Property details' : 'Retreat details'}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Type: {REVIEW_KINDS[retreat.kind].label}. {REVIEW_KINDS[retreat.kind].description}
        </p>
        <Field id="rt-title" label={isProperty ? 'Property name' : 'Title'} error={err('title')}>
          <input id="rt-title" type="text" value={f.title} onChange={text('title')} />
        </Field>
        <Field id="rt-slug" label="Web address" hint="The last part of your public page’s address. Changing it breaks links you’ve already shared, so we’ll ask first." error={err('slug')}>
          <input id="rt-slug" type="text" value={f.slug} onChange={text('slug')} onBlur={() => void commitSlug()} aria-describedby="rt-slug-hint" />
        </Field>
        {!isProperty && (
          <div className="grid-2">
            <Field id="rt-start" label="Start date" error={err('startDate')}>
              <input id="rt-start" type="date" value={f.startDate} onChange={text('startDate')} />
            </Field>
            <Field id="rt-end" label="End date" error={err('endDate')}>
              <input id="rt-end" type="date" value={f.endDate} onChange={text('endDate')} />
            </Field>
          </div>
        )}
        {isProperty && (
          <Field id="rt-address" label="Property address" error={err('propertyAddress')}>
            <input id="rt-address" type="text" value={f.propertyAddress} onChange={text('propertyAddress')} />
          </Field>
        )}
        <Field id="rt-location" label={isProperty ? 'Area or region' : 'Locations'} error={err('locationSummary')}>
          <input id="rt-location" type="text" value={f.locationSummary} onChange={text('locationSummary')} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{isProperty ? 'Amenities' : 'Route summary'}</legend>
          <p className="small muted" style={{ marginTop: 0 }}>
            {isProperty
              ? 'Up to six short items, such as “Heated yoga shala” or “Vegetarian kitchen”.'
              : 'Up to four short lines, shown as confirmed facts. Leave out times you’re not sure of.'}
          </p>
          {(isProperty ? f.amenities : f.route).map((line, i) => (
            <div className="field" key={i} style={{ marginBottom: '0.5rem' }}>
              <label htmlFor={`rt-line-${i}`} className="sr-only">
                {isProperty ? 'Amenity' : 'Route line'} {i + 1}
              </label>
              <input
                id={`rt-line-${i}`}
                type="text"
                value={line}
                onChange={(e) => {
                  setSaved(false)
                  const key = isProperty ? 'amenities' : 'route'
                  setF((x) => ({ ...x, [key]: x[key].map((r, j) => (j === i ? e.target.value : r)) }))
                }}
              />
            </div>
          ))}
          {err(isProperty ? 'amenities' : 'routeSummary') && (
            <p className="small" style={{ color: 'var(--danger)' }}>
              {err(isProperty ? 'amenities' : 'routeSummary')}
            </p>
          )}
        </fieldset>
        <div className="grid-2">
          {!isProperty && (
            <Field id="rt-itinerary" label="Full itinerary link" error={err('itineraryUrl')}>
              <input id="rt-itinerary" type="url" placeholder="https://" value={f.itineraryUrl} onChange={text('itineraryUrl')} />
            </Field>
          )}
          <Field id="rt-page" label={isProperty ? 'Property website link' : 'Retreat page link'} error={err('retreatPageUrl')}>
            <input id="rt-page" type="url" placeholder="https://" value={f.retreatPageUrl} onChange={text('retreatPageUrl')} />
          </Field>
        </div>
      </section>

      <section className="card" aria-labelledby="ov-contact">
        <h2 id="ov-contact">Organiser and contact</h2>
        <Field id="rt-organiser" label="Organiser display name" error={err('organiserName')}>
          <input id="rt-organiser" type="text" value={f.organiserName} onChange={text('organiserName')} />
        </Field>
        <div className="grid-2">
          <Field id="rt-email" label="Contact email" error={err('contactEmail')}>
            <input id="rt-email" type="email" value={f.contactEmail} onChange={text('contactEmail')} />
          </Field>
          <Field id="rt-phone" label="Contact phone" error={err('contactPhone')}>
            <input id="rt-phone" type="text" inputMode="tel" value={f.contactPhone} onChange={text('contactPhone')} />
          </Field>
        </div>
        <p className="small muted">Whether these show on your public page is set in the Public site tab.</p>
        <Field id="rt-privacy" label="Privacy notice link" error={err('privacyUrl')}>
          <input id="rt-privacy" type="url" placeholder="https://" value={f.privacyUrl} onChange={text('privacyUrl')} />
        </Field>
      </section>

      <section className="card" aria-labelledby="ov-collect">
        <h2 id="ov-collect">Collecting responses</h2>
        <Field id="rt-status" label="Status" error={err('status')}>
          <select id="rt-status" value={f.status} onChange={text('status')}>
            {(Object.keys(RETREAT_STATUS_LABELS) as Array<Retreat['status']>).map((s) => (
              <option key={s} value={s}>
                {RETREAT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid-2">
          <Field id="rt-opens" label="Invitations open" hint="Optional. Your local time." error={err('inviteOpensAt')}>
            <input id="rt-opens" type="datetime-local" value={f.inviteOpensAt} onChange={text('inviteOpensAt')} />
          </Field>
          <Field id="rt-closes" label="Invitations close" hint="Optional. Your local time." error={err('inviteClosesAt')}>
            <input id="rt-closes" type="datetime-local" value={f.inviteClosesAt} onChange={text('inviteClosesAt')} />
          </Field>
        </div>
        <div className="grid-2">
        </div>
        <Switch checked={f.draftEditingEnabled} onChange={toggle('draftEditingEnabled')} label="Guests can save drafts and come back later" />
        <details className="advanced">
          <summary>More options</summary>
          <div className="grid-2" style={{ marginTop: '0.75rem' }}>
            <Field id="rt-ttl" label="Invitation links expire after (days)" hint="Applies to links issued from now on." error={err('inviteTtlDays')}>
              <input id="rt-ttl" type="number" min={1} max={365} value={f.inviteTtlDays} onChange={text('inviteTtlDays')} />
            </Field>
            <Field
              id="rt-threshold"
              label="Hide category scores until this many guests reply"
              hint="Protects guests’ identities while numbers are small (3–50)."
              error={err('aggregateThreshold')}
            >
              <input id="rt-threshold" type="number" min={3} max={50} value={f.aggregateThreshold} onChange={text('aggregateThreshold')} />
            </Field>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            What visitors see on your public page (stories, star ratings, slideshow) is set in the Public site tab.
          </p>
        </details>
      </section>

      <section className="card" aria-labelledby="ov-categories">
        <h2 id="ov-categories">Private feedback categories</h2>
        <p className="small muted">
          Guests rate each of these privately. Removing a category hides its existing ratings from views and exports; renaming keeps them.
        </p>
        <ol className="stack" style={{ paddingLeft: '1.25rem' }}>
          {categories.map((c, i) => (
            <li key={c.key}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
                  <label htmlFor={`cat-${c.key}`}>Category {i + 1}</label>
                  <input
                    id={`cat-${c.key}`}
                    type="text"
                    value={c.label}
                    onChange={(e) => {
                      setSaved(false)
                      setDirty(true)
                      setCategories((all) => all.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))
                    }}
                  />
                </div>
                <button type="button" className="btn secondary small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.label} up`}>
                  Up
                </button>
                <button type="button" className="btn secondary small" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.label} down`}>
                  Down
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={async () => {
                    if (
                      !c.isNew &&
                      !(await confirm({ title: `Remove “${c.label}”?`, message: 'Its existing ratings will be hidden from views and exports.', confirmLabel: 'Remove', danger: true }))
                    )
                      return
                    setSaved(false)
                    setDirty(true)
                    setCategories((all) => all.filter((x) => x.key !== c.key))
                  }}
                  aria-label={`Remove ${c.label}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
            <label htmlFor="cat-new">New category</label>
            <input
              id="cat-new"
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCategory()
                }
              }}
            />
          </div>
          <button type="button" className="btn secondary" onClick={addCategory} disabled={!newCategory.trim() || categories.length >= 20}>
            Add category
          </button>
        </div>
        {err('feedbackCategories') && <p className="small" style={{ color: 'var(--danger)' }}>{err('feedbackCategories')}</p>}
      </section>

      <div className="save-status" aria-live="polite">
        {save.isPending || saveSlug.isPending ? (
          <span className="muted">Saving…</span>
        ) : save.error || saveSlug.error ? (
          <span style={{ color: 'var(--danger)' }}>Not saved: check the highlighted fields</span>
        ) : dirty ? (
          <span className="muted">Saving shortly…</span>
        ) : saved ? (
          <span className="badge ok">All changes saved</span>
        ) : (
          <span className="muted">Changes save automatically</span>
        )}
      </div>
      <MutationError
        error={save.error}
        shownFields={['title', 'slug', 'startDate', 'endDate', 'propertyAddress', 'amenities', 'locationSummary', 'routeSummary', 'itineraryUrl', 'retreatPageUrl', 'organiserName', 'contactEmail', 'contactPhone', 'privacyUrl', 'status', 'inviteOpensAt', 'inviteClosesAt', 'inviteTtlDays', 'aggregateThreshold', 'feedbackCategories']}
      />
    </form>
  )
}
