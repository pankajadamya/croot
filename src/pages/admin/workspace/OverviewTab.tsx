import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orgApi, patch } from '../../../lib/api'
import { toDateInput } from '../../../lib/format'
import { slugify } from '../../../../shared/slug'
import { REVIEW_KINDS, type FeedbackCategory } from '../../../../shared/categories'
import { Field, Switch } from '../../../components/Controls'
import { fieldError, fromLocalInput, MutationError, orgKey, retreatKey, RETREAT_STATUS_LABELS, toLocalInput, useOrgSummary } from '../adminUi'
import type { Retreat, RetreatStats } from '../types'

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
      {/* Remount when the saved retreat changes so the form shows what the server stored. */}
      <SettingsForm key={retreat.updatedAt} orgSlug={orgSlug} retreat={retreat} />
    </div>
  )
}

type CategoryRow = FeedbackCategory & { isNew?: boolean }

function SettingsForm({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
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
    contactPublic: retreat.contactPublic,
    privacyUrl: retreat.privacyUrl ?? '',
    status: retreat.status,
    inviteOpensAt: toLocalInput(retreat.inviteOpensAt),
    inviteClosesAt: toLocalInput(retreat.inviteClosesAt),
    inviteTtlDays: String(retreat.inviteTtlDays),
    draftEditingEnabled: retreat.draftEditingEnabled,
    publicReviewsEnabled: retreat.publicReviewsEnabled,
    writingSlideshowEnabled: retreat.writingSlideshowEnabled,
    heroSlideshowEnabled: retreat.heroSlideshowEnabled,
    showPublicRating: retreat.showPublicRating,
    aggregateThreshold: String(retreat.aggregateThreshold),
  }))
  const [categories, setCategories] = useState<CategoryRow[]>(retreat.feedbackCategories)
  const [newCategory, setNewCategory] = useState('')
  const [saved, setSaved] = useState(false)

  const text = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setSaved(false)
    setF((x) => ({ ...x, [k]: e.target.value }))
  }
  const toggle = (k: keyof typeof f) => (v: boolean) => {
    setSaved(false)
    setF((x) => ({ ...x, [k]: v }))
  }

  const save = useMutation({
    mutationFn: () =>
      patch<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats/${retreat.id}`, {
        title: f.title,
        slug: f.slug,
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
        contactPublic: f.contactPublic,
        privacyUrl: f.privacyUrl.trim() || null,
        status: f.status,
        inviteOpensAt: fromLocalInput(f.inviteOpensAt),
        inviteClosesAt: fromLocalInput(f.inviteClosesAt),
        inviteTtlDays: Number(f.inviteTtlDays),
        draftEditingEnabled: f.draftEditingEnabled,
        publicReviewsEnabled: f.publicReviewsEnabled,
        writingSlideshowEnabled: f.writingSlideshowEnabled,
        heroSlideshowEnabled: f.heroSlideshowEnabled,
        showPublicRating: f.showPublicRating,
        aggregateThreshold: Number(f.aggregateThreshold),
        feedbackCategories: categories.map(({ key, label }) => ({ key, label: label.trim() })),
      }),
    onSuccess: ({ retreat: updated }) => {
      queryClient.setQueryData(retreatKey(orgSlug, retreat.id), updated)
      void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
      setSaved(true)
    },
  })

  const err = (k: string) => fieldError(save.error, k)

  function addCategory() {
    const label = newCategory.trim()
    if (!label) return
    const base = slugify(label, 36) || 'category'
    let key = base
    for (let i = 2; categories.some((c) => c.key === key); i++) key = `${base}-${i}`
    setCategories((c) => [...c, { key, label, isNew: true }])
    setNewCategory('')
    setSaved(false)
  }

  function move(index: number, delta: number) {
    setCategories((c) => {
      const next = [...c]
      const [item] = next.splice(index, 1)
      next.splice(index + delta, 0, item)
      return next
    })
    setSaved(false)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
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
        <Field id="rt-slug" label="Web address slug" hint="Changing this changes the public address; old links will stop working." error={err('slug')}>
          <input id="rt-slug" type="text" value={f.slug} onChange={text('slug')} aria-describedby="rt-slug-hint" />
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
        <Switch
          checked={f.contactPublic}
          onChange={toggle('contactPublic')}
          label="Show contact details on the public site"
          description="Off until you have checked the details above are right to publish."
        />
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
          <Field id="rt-ttl" label="Invitation links expire after (days)" hint="Applies to links issued from now on." error={err('inviteTtlDays')}>
            <input id="rt-ttl" type="number" min={1} max={365} value={f.inviteTtlDays} onChange={text('inviteTtlDays')} />
          </Field>
          <Field
            id="rt-threshold"
            label="Minimum responses before showing scores"
            hint="Category scores stay hidden below this number to protect guests’ identities (3–50)."
            error={err('aggregateThreshold')}
          >
            <input id="rt-threshold" type="number" min={3} max={50} value={f.aggregateThreshold} onChange={text('aggregateThreshold')} />
          </Field>
        </div>
        <div className="stack">
          <Switch checked={f.draftEditingEnabled} onChange={toggle('draftEditingEnabled')} label="Guests can save drafts and come back later" />
          <Switch checked={f.publicReviewsEnabled} onChange={toggle('publicReviewsEnabled')} label="Show published guest stories on the public site" />
          <Switch checked={f.heroSlideshowEnabled} onChange={toggle('heroSlideshowEnabled')} label="Show your image slideshow on the public site" />
          <Switch
            checked={f.writingSlideshowEnabled}
            onChange={toggle('writingSlideshowEnabled')}
            label="Show retreat photos beside the guest’s writing form"
            description="A quiet memory prompt guests can hide. It never covers the form."
          />
          <Switch
            checked={f.showPublicRating}
            onChange={toggle('showPublicRating')}
            label="Show a guest’s overall rating with their published story"
            description="Applies to stories published or republished after this change."
          />
        </div>
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
                  onClick={() => {
                    setSaved(false)
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

      <div className="card tight spread" style={{ position: 'sticky', bottom: '1rem' }}>
        <div aria-live="polite">{saved && <span className="badge ok">Saved</span>}</div>
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      <MutationError
        error={save.error}
        shownFields={['title', 'slug', 'startDate', 'endDate', 'propertyAddress', 'amenities', 'locationSummary', 'routeSummary', 'itineraryUrl', 'retreatPageUrl', 'organiserName', 'contactEmail', 'contactPhone', 'privacyUrl', 'status', 'inviteOpensAt', 'inviteClosesAt', 'inviteTtlDays', 'aggregateThreshold', 'feedbackCategories']}
      />
    </form>
  )
}
