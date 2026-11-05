import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { orgApi, post } from '../../lib/api'
import { slugify } from '../../../shared/slug'
import type { ReviewKind } from '../../../shared/categories'
import { Field } from '../../components/Controls'
import { AdminShell } from './AdminShell'
import { fieldError, MutationError, orgKey } from './adminUi'
import type { Retreat } from './types'

const KIND_CHOICES: Array<{ kind: ReviewKind; title: string; detail: string }> = [
  {
    kind: 'itinerary',
    title: 'An itinerary retreat (a hosted journey with fixed dates)',
    detail: 'The group travels together on set dates and reviews the whole journey afterwards.',
  },
  {
    kind: 'property',
    title: 'A retreat property (guests staying at your venue)',
    detail: 'Guests come and go throughout the year and review their own stay.',
  },
]

export default function RetreatNew() {
  const { orgSlug = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ReviewKind | null>(null)
  const [form, setForm] = useState({ title: '', slug: '', startDate: '', endDate: '', locationSummary: '', propertyAddress: '', organiserName: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const create = useMutation({
    mutationFn: () => {
      const common = {
        kind,
        title: form.title,
        slug: slugTouched ? form.slug : slugify(form.title),
        locationSummary: form.locationSummary,
        organiserName: form.organiserName,
      }
      // Feedback categories are left to the server, which applies the defaults for this kind.
      const body =
        kind === 'property'
          ? { ...common, propertyAddress: form.propertyAddress.trim() || null }
          : { ...common, startDate: form.startDate || null, endDate: form.endDate || null }
      return post<{ retreat: Retreat }>(`${orgApi(orgSlug)}/retreats`, body)
    },
    onSuccess: ({ retreat }) => {
      void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
      navigate(`/admin/${orgSlug}/retreats/${retreat.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (kind) create.mutate()
  }

  const shownSlug = slugTouched ? form.slug : slugify(form.title)
  const err = (k: string) => fieldError(create.error, k)
  const noun = kind === 'property' ? 'property' : 'retreat'

  return (
    <AdminShell orgSlug={orgSlug}>
      <p className="small">
        <Link to={`/admin/${orgSlug}`}>← Programmes</Link>
      </p>
      <h1>New programme</h1>
      <form className="card" onSubmit={submit} noValidate style={{ maxWidth: 760 }}>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1.5rem' }}>
          <legend style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>What are you collecting reviews for?</legend>
          <div className="stack">
            {KIND_CHOICES.map((c) => (
              <label key={c.kind} className={`choice-card${kind === c.kind ? ' selected' : ''}`}>
                <input type="radio" name="kind" value={c.kind} checked={kind === c.kind} onChange={() => setKind(c.kind)} />
                <span>
                  <span style={{ display: 'block', fontWeight: 600 }}>{c.title}</span>
                  <span className="small muted" style={{ fontWeight: 400 }}>
                    {c.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {err('kind') && <p className="small" style={{ color: 'var(--danger)' }}>{err('kind')}</p>}
        </fieldset>

        {kind && (
          <>
            <Field id="nr-title" label={kind === 'property' ? 'Property name' : 'Retreat title'} error={err('title')}>
              <input id="nr-title" type="text" required value={form.title} onChange={set('title')} />
            </Field>
            <Field id="nr-slug" label="Web address slug" hint="Lower-case letters, numbers and hyphens. Used in the public address." error={err('slug')}>
              <input
                id="nr-slug"
                type="text"
                value={shownSlug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setForm((f) => ({ ...f, slug: e.target.value }))
                }}
                aria-describedby="nr-slug-hint"
              />
            </Field>
            {kind === 'itinerary' ? (
              <div className="grid-2">
                <Field id="nr-start" label="Start date" error={err('startDate')}>
                  <input id="nr-start" type="date" required value={form.startDate} onChange={set('startDate')} />
                </Field>
                <Field id="nr-end" label="End date" error={err('endDate')}>
                  <input id="nr-end" type="date" required value={form.endDate} onChange={set('endDate')} />
                </Field>
              </div>
            ) : (
              <Field id="nr-address" label="Property address" hint="Optional. Shown publicly only if you choose to." error={err('propertyAddress')}>
                <input id="nr-address" type="text" value={form.propertyAddress} onChange={set('propertyAddress')} aria-describedby="nr-address-hint" />
              </Field>
            )}
            <Field
              id="nr-location"
              label={kind === 'property' ? 'Area or region' : 'Locations'}
              hint={kind === 'property' ? 'For example: The Algarve, Portugal' : 'For example: Rishikesh and the Himalayan foothills'}
              error={err('locationSummary')}
            >
              <input id="nr-location" type="text" value={form.locationSummary} onChange={set('locationSummary')} aria-describedby="nr-location-hint" />
            </Field>
            <Field id="nr-organiser" label={kind === 'property' ? 'Host display name' : 'Organiser display name'} error={err('organiserName')}>
              <input id="nr-organiser" type="text" value={form.organiserName} onChange={set('organiserName')} />
            </Field>
            <p className="small muted">
              You can set the invitation window, {kind === 'property' ? 'amenities' : 'route'}, feedback categories and public site after creating the {noun}. New programmes
              start as drafts.
            </p>
          </>
        )}
        <MutationError error={create.error} shownFields={['kind', 'title', 'slug', 'startDate', 'endDate', 'propertyAddress', 'locationSummary', 'organiserName']} />
        <div className="row">
          <button className="btn" type="submit" disabled={!kind || create.isPending}>
            {create.isPending ? 'Creating…' : `Create ${noun}`}
          </button>
          <Link className="btn secondary" to={`/admin/${orgSlug}`}>
            Cancel
          </Link>
        </div>
      </form>
    </AdminShell>
  )
}
