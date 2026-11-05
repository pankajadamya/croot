import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { del, get, orgApi, post } from '../../../lib/api'
import { formatDate, formatDateTime } from '../../../lib/format'
import { Field } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { CopyButton, fieldError, InviteStateBadge, MutationError, orgKey } from '../adminUi'
import type { AttendeeRowView, CsvPreviewRow, Retreat } from '../types'

interface IssuedLink {
  attendeeId: string
  name: string
  email: string
  url: string
}

const CSV_STATUS: Record<CsvPreviewRow['status'], [string, string]> = {
  ok: ['Ready', 'ok'],
  invalid: ['Invalid', 'danger'],
  duplicate_in_file: ['Duplicate in file', 'warn'],
  already_imported: ['Already added', 'neutral'],
}

export function InvitationsTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const queryClient = useQueryClient()
  const isProperty = retreat.kind === 'property'
  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}`
  const key = ['admin', orgSlug, 'attendees', retreat.id]
  const attendees = useQuery({ queryKey: key, queryFn: () => get<{ attendees: AttendeeRowView[] }>(`${base}/attendees`).then((r) => r.attendees) })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
  }

  // Links are shown once, straight from the server response, and kept only in this page's memory.
  const [issued, setIssued] = useState<IssuedLink[]>([])
  const addIssued = (links: IssuedLink[]) => setIssued((prev) => [...links, ...prev.filter((p) => !links.some((l) => l.attendeeId === p.attendeeId))])

  const generateMissing = useMutation({
    mutationFn: () => post<{ links: IssuedLink[] }>(`${base}/invites/generate-missing`),
    onSuccess: ({ links }) => {
      addIssued(links)
      refresh()
    },
  })
  const issue = useMutation({
    mutationFn: (a: AttendeeRowView) => post<{ url: string }>(`${orgApi(orgSlug)}/attendees/${a.id}/invite`).then((r) => ({ attendeeId: a.id, name: a.name, email: a.email, url: r.url })),
    onSuccess: (link) => {
      addIssued([link])
      refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (a: AttendeeRowView) => post(`${orgApi(orgSlug)}/attendees/${a.id}/revoke`),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (a: AttendeeRowView) => del(`${orgApi(orgSlug)}/attendees/${a.id}`),
    onSuccess: refresh,
  })
  // Croot emails the links itself; copying them is the fallback.
  const [sentNote, setSentNote] = useState<string | null>(null)
  const emailAll = useMutation({
    mutationFn: () => post<{ sent: number; failed: string[] }>(`${base}/invites/email-all`),
    onSuccess: (r) => {
      setSentNote(`Emailed ${r.sent} invitation${r.sent === 1 ? '' : 's'}.${r.failed.length ? ` Couldn’t email: ${r.failed.join(', ')}.` : ''}`)
      refresh()
    },
  })
  const emailOne = useMutation({
    mutationFn: (a: AttendeeRowView) => post(`${orgApi(orgSlug)}/attendees/${a.id}/email-invite`).then(() => a),
    onSuccess: (a) => {
      setSentNote(`Invitation emailed to ${a.name}.`)
      refresh()
    },
  })
  const collecting = retreat.status === 'collecting'
  const toEmail =
    attendees.data?.filter((a) => !(a.invitation?.emailedAt && !a.invitation.revoked) && !['submitted', 'consented', 'published', 'withdrawn'].includes(a.state)).length ?? 0

  // Copied-but-not-sent links can't be shown again, so warn before leaving with them on screen.
  useEffect(() => {
    if (!issued.length) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [issued.length])

  const withoutLink = attendees.data?.filter((a) => !a.invitation).length ?? 0
  const allLinksText = issued.map((l) => `${l.name}\t${l.email}\t${l.url}`).join('\n')
  const rowError = issue.error || revoke.error || remove.error || emailOne.error || emailAll.error

  return (
    <div className="stack">
      {issued.length > 0 && (
        <section className="notice warn" aria-labelledby="issued-title" role="status">
          <h2 id="issued-title" style={{ fontSize: '1.15rem', marginTop: 0 }}>
            New invitation links
          </h2>
          <p className="small">
            Copy these now and send each one privately to its guest. For guests’ safety Croot keeps no readable copy, so they <strong>cannot be shown again</strong> once you leave
            this page — you can only reissue a new link, which cancels the old one.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  <th scope="col">Link</th>
                  <th scope="col">
                    <span className="sr-only">Copy</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {issued.map((l) => (
                  <tr key={l.attendeeId}>
                    <td>
                      {l.name}
                      <div className="small muted">{l.email}</div>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`link-${l.attendeeId}`}>
                        Invitation link for {l.name}
                      </label>
                      <input id={`link-${l.attendeeId}`} type="text" readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} className="mono-input" />
                    </td>
                    <td>
                      <CopyButton text={l.url} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <CopyButton text={allLinksText} label="Copy all (name, email, link)" className="btn secondary" />
            <button type="button" className="btn ghost" onClick={() => setIssued([])}>
              I’ve copied them — hide links
            </button>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="att-title">
        <div className="spread">
          <h2 id="att-title" style={{ margin: 0 }}>
            Guests and links
          </h2>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={!collecting || toEmail === 0 || emailAll.isPending}
              onClick={() => {
                if (window.confirm(`Email an invitation to ${toEmail} guest${toEmail === 1 ? '' : 's'}? Each gets their own private link.`)) emailAll.mutate()
              }}
            >
              {emailAll.isPending ? 'Sending…' : `Email invitations${toEmail ? ` (${toEmail})` : ''}`}
            </button>
            <button type="button" className="btn ghost" disabled={!collecting || withoutLink === 0 || generateMissing.isPending} onClick={() => generateMissing.mutate()}>
              {generateMissing.isPending ? 'Making links…' : 'Copy links to send yourself'}
            </button>
          </div>
        </div>
        {!collecting && (
          <p className="notice warn small" role="status">
            {retreat.status === 'draft'
              ? 'This programme is a draft, so invitation links won’t open yet. Use “Start collecting reviews” at the top of the page first.'
              : 'Reviews aren’t being collected for this programme, so new invitations are paused.'}
          </p>
        )}
        {sentNote && (
          <p className="notice ok small" role="status">
            {sentNote}
          </p>
        )}
        <p className="small muted">
          Croot emails each guest their own private link (no name or email in it). Links expire after {retreat.inviteTtlDays} days. Sending again makes
          a fresh link and cancels the old one, but keeps any draft.
        </p>
        <MutationError error={generateMissing.error} />
        <MutationError error={rowError} />
        {attendees.isLoading && <Loading />}
        {attendees.error && <ErrorNotice error={attendees.error} />}
        {attendees.data && attendees.data.length === 0 && <p className="muted">No guests yet. Import a list or add someone below.</p>}
        {attendees.data && attendees.data.length > 0 && (
          <div className="table-wrap">
            <table className="data stack-mobile">
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  {isProperty && <th scope="col">Stay</th>}
                  <th scope="col">Status</th>
                  <th scope="col">Link</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attendees.data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.responseId ? <Link to={`/admin/${orgSlug}/responses/${a.responseId}`}>{a.name}</Link> : a.name}
                      <div className="small muted">{a.email}</div>
                    </td>
                    {isProperty && (
                      <td className="small">
                        {a.stayStart ? formatDate(a.stayStart) : '—'}
                        {a.stayEnd ? ` to ${formatDate(a.stayEnd)}` : ''}
                      </td>
                    )}
                    <td data-label="Status">
                      <InviteStateBadge state={a.state} />
                    </td>
                    <td className="small muted" data-label="Link">
                      {a.invitation ? (
                        <>
                          {a.invitation.emailedAt ? <div>Emailed {formatDateTime(a.invitation.emailedAt)}</div> : <div>Not emailed</div>}
                          Link ending …{a.invitation.hint}
                          <div>Issued {formatDateTime(a.invitation.issuedAt)}</div>
                          {a.invitation.openedAt && <div>Opened {formatDateTime(a.invitation.openedAt)}</div>}
                          {!a.invitation.revoked && <div>Expires {formatDate(a.invitation.expiresAt)}</div>}
                        </>
                      ) : (
                        'None'
                      )}
                    </td>
                    <td data-label="Actions">
                      <div className="row" style={{ gap: '0.4rem' }}>
                        <button type="button" className="btn secondary small" disabled={!collecting || emailOne.isPending} onClick={() => emailOne.mutate(a)}>
                          {a.invitation?.emailedAt ? 'Email again' : 'Email invitation'}
                        </button>
                        <button type="button" className="btn ghost small" disabled={issue.isPending} onClick={() => issue.mutate(a)}>
                          Copy a link
                        </button>
                        {a.invitation && !a.invitation.revoked && (
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={revoke.isPending}
                            onClick={() => {
                              if (window.confirm(`Revoke ${a.name}’s link? It will stop working immediately. Their draft is kept.`)) revoke.mutate(a)
                            }}
                          >
                            Revoke
                          </button>
                        )}
                        {!a.responseId && (
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (window.confirm(`Remove ${a.name} from this programme? Any unsent draft is deleted.`)) remove.mutate(a)
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <CsvImport orgSlug={orgSlug} retreat={retreat} onDone={refresh} />
        <AddAttendee orgSlug={orgSlug} retreat={retreat} onDone={refresh} />
      </div>
    </div>
  )
}

function CsvImport({ orgSlug, retreat, onDone }: { orgSlug: string; retreat: Retreat; onDone: () => void }) {
  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}`
  const isProperty = retreat.kind === 'property'
  const [csv, setCsv] = useState('')
  const [rows, setRows] = useState<CsvPreviewRow[] | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const preview = useMutation({
    mutationFn: () => post<{ rows: CsvPreviewRow[] }>(`${base}/attendees/preview`, { csv }),
    onSuccess: (r) => {
      setRows(r.rows)
      setResult(null)
    },
  })
  const ok = rows?.filter((r) => r.status === 'ok') ?? []
  const commit = useMutation({
    mutationFn: () =>
      post<{ imported: number; skipped: number }>(`${base}/attendees/import`, {
        rows: ok.map((r) => ({ name: r.name, email: r.email, stayStart: r.stayStart ?? null, stayEnd: r.stayEnd ?? null })),
      }),
    onSuccess: (r) => {
      setResult(`${r.imported} ${r.imported === 1 ? 'guest' : 'guests'} added${r.skipped ? `; ${r.skipped} skipped as already present` : ''}. Now generate their links.`)
      setRows(null)
      setCsv('')
      onDone()
    },
  })

  return (
    <section className="card" aria-labelledby="csv-title">
      <h2 id="csv-title">Import a guest list</h2>
      <Field
        id="csv-text"
        label="Paste CSV"
        hint={
          isProperty
            ? 'Columns: name, email, and optionally check-in and check-out dates (2026-10-23 or 23/10/2026). A header row is optional.'
            : 'Columns: name, email. A header row is optional. The list itself is not stored.'
        }
        error={fieldError(preview.error, 'csv')}
      >
        <textarea
          id="csv-text"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value)
            setRows(null)
          }}
          placeholder={isProperty ? 'name,email,check-in,check-out\nAsha Patel,asha@example.com,2026-10-23,2026-10-30' : 'name,email\nAsha Patel,asha@example.com'}
          aria-describedby="csv-text-hint"
          spellCheck={false}
        />
      </Field>
      <MutationError error={preview.error} shownFields={['csv']} />
      <button type="button" className="btn secondary" disabled={!csv.trim() || preview.isPending} onClick={() => preview.mutate()}>
        {preview.isPending ? 'Checking…' : 'Check list'}
      </button>
      {result && (
        <div className="notice ok" role="status" style={{ marginTop: '1rem' }}>
          {result}
        </div>
      )}
      {rows && (
        <div style={{ marginTop: '1rem' }}>
          <p>
            <strong>{ok.length}</strong> ready to add, {rows.length - ok.length} will be skipped.
          </p>
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  {isProperty && <th scope="col">Stay</th>}
                  <th scope="col">Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.email || '—'}</td>
                    {isProperty && (
                      <td className="small">
                        {r.stayStart ? formatDate(r.stayStart) : '—'}
                        {r.stayEnd ? ` to ${formatDate(r.stayEnd)}` : ''}
                      </td>
                    )}
                    <td>
                      <span className={`badge ${CSV_STATUS[r.status][1]}`}>{CSV_STATUS[r.status][0]}</span>
                      {r.problem && <div className="small muted">{r.problem}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MutationError error={commit.error} />
          <button type="button" className="btn" style={{ marginTop: '0.75rem' }} disabled={ok.length === 0 || commit.isPending} onClick={() => commit.mutate()}>
            {commit.isPending ? 'Adding…' : `Add ${ok.length} ${ok.length === 1 ? 'guest' : 'guests'}`}
          </button>
        </div>
      )}
    </section>
  )
}

function AddAttendee({ orgSlug, retreat, onDone }: { orgSlug: string; retreat: Retreat; onDone: () => void }) {
  const isProperty = retreat.kind === 'property'
  const empty = { name: '', email: '', stayStart: '', stayEnd: '' }
  const [form, setForm] = useState(empty)
  const [added, setAdded] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () =>
      post(`${orgApi(orgSlug)}/retreats/${retreat.id}/attendees`, {
        name: form.name,
        email: form.email,
        ...(isProperty ? { stayStart: form.stayStart || null, stayEnd: form.stayEnd || null } : {}),
      }),
    onSuccess: () => {
      setAdded(form.name)
      setForm(empty)
      onDone()
    },
  })
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  function submit(e: FormEvent) {
    e.preventDefault()
    setAdded(null)
    add.mutate()
  }
  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby="add-title">
      <h2 id="add-title">Add one guest</h2>
      <Field id="add-name" label="Name" error={fieldError(add.error, 'name')}>
        <input id="add-name" type="text" value={form.name} onChange={set('name')} />
      </Field>
      <Field id="add-email" label="Email" error={fieldError(add.error, 'email')}>
        <input id="add-email" type="email" value={form.email} onChange={set('email')} />
      </Field>
      {isProperty && (
        <div className="grid-2">
          <Field id="add-start" label="Check-in (optional)" error={fieldError(add.error, 'stayStart')}>
            <input id="add-start" type="date" value={form.stayStart} onChange={set('stayStart')} />
          </Field>
          <Field id="add-end" label="Check-out (optional)" error={fieldError(add.error, 'stayEnd')}>
            <input id="add-end" type="date" value={form.stayEnd} onChange={set('stayEnd')} />
          </Field>
        </div>
      )}
      {isProperty && <p className="small muted">Stay dates are private to your team and help you match feedback to a stay.</p>}
      <MutationError error={add.error} shownFields={['name', 'email', 'stayStart', 'stayEnd']} />
      {added && (
        <div className="notice ok" role="status">
          {added} added. Issue their link from the table above.
        </div>
      )}
      <button className="btn secondary" type="submit" disabled={add.isPending}>
        {add.isPending ? 'Adding…' : 'Add guest'}
      </button>
    </form>
  )
}
