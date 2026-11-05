import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { RETENTION_LIMITS, type RetentionKey } from '../../../shared/legal'
import { get, orgApi, patch, post } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'
import { MutationError, useOrgSummary } from './adminUi'
import type { AttendeeRowView } from './types'

interface PrivacySettings extends Record<RetentionKey, number> {
  legalName: string | null
  legalAddress: string | null
  privacyEmail: string | null
  dpoContact: string | null
  contactEmail: string | null
  dpaVersion: string | null
  dpaAcceptedAt: string | null
}

/** Organiser's GDPR controls: controller details, processing terms, retention, guest requests, export. */
export default function Privacy() {
  const { orgSlug = '' } = useParams()
  const base = orgApi(orgSlug)
  const qc = useQueryClient()
  const summary = useOrgSummary(orgSlug)
  const isOwner = summary.data?.org.role === 'owner' || summary.data?.org.role === 'platform'
  const q = useQuery({
    queryKey: ['admin', orgSlug, 'privacy'],
    queryFn: () => get<{ settings: PrivacySettings; currentTermsVersion: string }>(`${base}/privacy`),
  })
  const [form, setForm] = useState<PrivacySettings | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (q.data) setForm(q.data.settings)
  }, [q.data])

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<{ settings: PrivacySettings }>(`${base}/privacy`, body),
    onSuccess: async () => {
      setSaved(true)
      await qc.invalidateQueries({ queryKey: ['admin', orgSlug, 'privacy'] })
    },
  })

  if (q.isLoading || !form) return <AdminShell orgSlug={orgSlug}>{q.error ? <ErrorNotice error={q.error} /> : <Loading />}</AdminShell>
  const termsCurrent = q.data!.settings.dpaVersion === q.data!.currentTermsVersion

  function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    const { legalName, legalAddress, privacyEmail, dpoContact } = form!
    const retention = Object.fromEntries((Object.keys(RETENTION_LIMITS) as RetentionKey[]).map((k) => [k, Number(form![k])]))
    save.mutate({ legalName: legalName || null, legalAddress: legalAddress || null, privacyEmail: privacyEmail || '', dpoContact: dpoContact || null, ...retention })
  }

  const set = (k: keyof PrivacySettings) => (e: { target: { value: string } }) => setForm({ ...form!, [k]: e.target.value } as PrivacySettings)

  return (
    <AdminShell orgSlug={orgSlug}>
      <div className="spread">
        <h1>Privacy and data</h1>
        <Link to={`/o/${orgSlug}/privacy`} target="_blank">
          View your guest privacy notice ↗
        </Link>
      </div>
      <p className="muted" style={{ maxWidth: '70ch' }}>
        Under UK and EU GDPR your organisation is the <strong>controller</strong> of your guests’ information and Croot is your processor. These
        settings feed your guest privacy notice and the automatic deletion schedule.
      </p>

      <section className={`notice ${termsCurrent ? 'ok' : 'warn'}`} style={{ margin: '1.5rem 0' }}>
        <strong>Data processing terms:</strong>{' '}
        {termsCurrent ? (
          <>accepted (version {q.data!.settings.dpaVersion}) on {formatDate(q.data!.settings.dpaAcceptedAt)}.</>
        ) : (
          <>
            {q.data!.settings.dpaVersion ? `version ${q.data!.settings.dpaVersion} accepted; a newer version is available.` : 'not yet accepted.'} Please
            read the <Link to="/legal/terms" target="_blank">processing terms</Link>.{' '}
            {isOwner && (
              <button className="btn small" onClick={() => save.mutate({ acceptTerms: true })} disabled={save.isPending}>
                Accept version {q.data!.currentTermsVersion}
              </button>
            )}
          </>
        )}
      </section>

      <form className="stack" onSubmit={submit}>
        <section className="card">
          <h2>Controller details</h2>
          <p className="small muted">Shown in your guest privacy notice. Guests use these to contact you about their data.</p>
          <div className="grid-2">
            <Field id="legalName" label="Legal name of your business">
              <input id="legalName" type="text" value={form.legalName ?? ''} onChange={set('legalName')} disabled={!isOwner} />
            </Field>
            <Field id="privacyEmail" label="Privacy contact email" hint={form.contactEmail ? `Falls back to ${form.contactEmail}` : undefined}>
              <input id="privacyEmail" type="email" value={form.privacyEmail ?? ''} onChange={set('privacyEmail')} disabled={!isOwner} />
            </Field>
          </div>
          <Field id="legalAddress" label="Postal address">
            <textarea id="legalAddress" value={form.legalAddress ?? ''} onChange={set('legalAddress')} style={{ minHeight: '4.5rem' }} disabled={!isOwner} />
          </Field>
          <Field id="dpoContact" label="Data protection officer or UK/EU representative (if you have one)">
            <input id="dpoContact" type="text" value={form.dpoContact ?? ''} onChange={set('dpoContact')} disabled={!isOwner} />
          </Field>
        </section>

        <section className="card">
          <h2>Retention</h2>
          <p className="small muted">
            Data is deleted automatically when these periods end. Stories a guest agreed to publish stay published until they withdraw them; everything
            else about that guest is removed when the response period ends.
          </p>
          <div className="grid-2">
            {(Object.keys(RETENTION_LIMITS) as RetentionKey[]).map((k) => {
              const l = RETENTION_LIMITS[k]
              return (
                <Field key={k} id={k} label={`${l.label} (${l.unit})`} hint={`Between ${l.min} and ${l.max}`}>
                  <input id={k} type="number" min={l.min} max={l.max} value={form[k]} onChange={set(k)} disabled={!isOwner} />
                </Field>
              )
            })}
          </div>
        </section>

        {isOwner ? (
          <div className="row">
            <button className="btn" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save privacy settings'}
            </button>
            {saved && !save.isPending && (
              <span className="muted" role="status">
                Saved
              </span>
            )}
          </div>
        ) : (
          <p className="muted small">Only organisation owners can change these settings.</p>
        )}
        <MutationError error={save.error} />
      </form>

      <GuestRequests orgSlug={orgSlug} isOwner={isOwner} />

      {isOwner && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2>Export everything</h2>
          <p className="small muted">A machine-readable copy of all programmes, guests, responses, permissions and settings, for your records or if you leave Croot.</p>
          <a className="btn secondary" href={`${base}/export`} download>
            Download organisation export (JSON)
          </a>
        </section>
      )}
    </AdminShell>
  )
}

/** Answer access and erasure requests that reach you by email or phone. */
function GuestRequests({ orgSlug, isOwner }: { orgSlug: string; isOwner: boolean }) {
  const base = orgApi(orgSlug)
  const qc = useQueryClient()
  const summary = useOrgSummary(orgSlug)
  const [programme, setProgramme] = useState('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<AttendeeRowView | null>(null)
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const attendees = useQuery({
    enabled: Boolean(programme),
    queryKey: ['admin', orgSlug, 'attendees', programme],
    queryFn: () => get<{ attendees: AttendeeRowView[] }>(`${base}/retreats/${programme}/attendees`).then((r) => r.attendees),
  })
  const erase = useMutation({
    mutationFn: (a: AttendeeRowView) => post(`${base}/attendees/${a.id}/erase`, { confirm: 'DELETE', reason }),
    onSuccess: async (_d, a) => {
      setDone(`${a.name}’s information has been erased.`)
      setTarget(null)
      setReason('')
      setConfirm('')
      await qc.invalidateQueries({ queryKey: ['admin', orgSlug] })
    },
  })
  const matches = (attendees.data ?? []).filter((a) => !search || `${a.name} ${a.email}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <section className="card" style={{ marginTop: '1.5rem' }}>
      <h2>Guest data requests</h2>
      <p className="small muted">
        Guests can download or delete their own data from their private response page. If someone asks you directly, find them here. You must reply
        within one month. Anonymous notes can’t be linked to anyone, so they’re never included.
      </p>
      {done && (
        <div className="notice ok" role="status">
          {done}
        </div>
      )}
      <div className="grid-2">
        <Field id="req-programme" label="Programme">
          <select id="req-programme" value={programme} onChange={(e) => setProgramme(e.target.value)}>
            <option value="">Choose…</option>
            {summary.data?.retreats.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </Field>
        <Field id="req-search" label="Name or email">
          <input id="req-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!programme} />
        </Field>
      </div>
      {attendees.isLoading && programme && <Loading />}
      {programme && attendees.data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Email</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 50).map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.email}</td>
                  <td className="row">
                    <a className="btn secondary small" href={`${base}/attendees/${a.id}/export`} download>
                      Export data
                    </a>
                    {isOwner && (
                      <button className="btn ghost small" onClick={() => setTarget(a)}>
                        Erase…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {matches.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No matching guests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <div className="notice error stack" style={{ marginTop: '1rem' }} role="dialog" aria-labelledby="erase-title">
          <h3 id="erase-title">Erase {target.name}?</h3>
          <p>This permanently deletes their invitation, response, private feedback, photos and permissions, and takes down anything published. It can’t be undone.</p>
          <Field id="erase-reason" label="Reason (kept in the audit log, without their name)">
            <input id="erase-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Erasure request by email, 5 Nov" />
          </Field>
          <Field id="erase-confirm" label="Type DELETE to confirm">
            <input id="erase-confirm" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <div className="row">
            <button className="btn danger" disabled={confirm !== 'DELETE' || !reason.trim() || erase.isPending} onClick={() => erase.mutate(target)}>
              Erase permanently
            </button>
            <button className="btn secondary" onClick={() => setTarget(null)}>
              Cancel
            </button>
          </div>
          <MutationError error={erase.error} />
        </div>
      )}
    </section>
  )
}
