import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { del, get, orgApi, patch, post } from '../../../lib/api'
import { formatDate, formatDateTime } from '../../../lib/format'
import { Field } from '../../../components/Controls'
import { ErrorNotice, Loading } from '../../../components/States'
import { useConfirm } from '../../../components/ConfirmDialog'
import { useAuth } from '../../../lib/auth'
import { ShareLink } from './ShareLink'
import { GroupLinkCard } from './GroupLinkCard'
import { CopyButton, fieldError, InviteStateBadge, MutationError, orgKey } from '../adminUi'
import type { AttendeeRowView, CsvPreviewRow, Retreat } from '../types'

interface IssuedLink {
  attendeeId: string
  name: string
  email: string | null
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
  // "Copy a link": makes a fresh link and puts it straight on the clipboard. The clipboard write starts
  // inside the click (as Safari requires) with the link arriving a moment later from the server.
  // url: the fresh link, kept on screen for WhatsApp or a QR code; showUrl when it couldn't be copied.
  const [copyNote, setCopyNote] = useState<{ id: string; text: string; url?: string; showUrl?: boolean } | null>(null)
  const confirm = useConfirm()
  const { session } = useAuth()
  // Removing a guest who has sent a review erases it too, so it's for owners (as on the Privacy page).
  const isOwner = Boolean(session?.user.isPlatformAdmin || session?.memberships.find((m) => m.slug === orgSlug)?.role === 'owner')
  function copyLink(a: AttendeeRowView) {
    // A guest without an email who has sent their review can't sign in to change it: a new link
    // made now is what lets them (until they send it again).
    if (!a.email && a.responseId) {
      return void confirm({
        title: `Make a link for ${a.name} to change their review?`,
        message: (
          <>
            <p>
              {a.name} has already sent their review, and their earlier link can’t change it. This new link lets them reopen it and make changes
              {a.invitation && !a.invitation.revoked ? ` (their current link, ending …${a.invitation.hint}, stops working)` : ''}.
            </p>
            <p>Once they send it again, this link stops allowing changes too. If it was already published, the published version stays up until you approve their changes.</p>
          </>
        ),
        confirmLabel: 'Make and copy link',
        onConfirm: () => makeAndCopy(a),
      })
    }
    if (!a.invitation || a.invitation.revoked) return makeAndCopy(a)
    // The copy runs inside the dialog's own button click, so the browser still allows it.
    void confirm({
      title: `Make a new link for ${a.name}?`,
      message: (
        <>
          <p>
            Their current link (ending …{a.invitation.hint}) will stop working, so they’ll need the new one. Anything they’ve already written is kept.
          </p>
          <p>The new link is copied for you to paste into a message.</p>
        </>
      ),
      confirmLabel: 'Make and copy new link',
      onConfirm: () => makeAndCopy(a),
    })
  }
  function makeAndCopy(a: AttendeeRowView) {
    setCopyNote(null)
    const link = issue.mutateAsync(a)
    const url = link.then((l) => l.url)
    let copied: Promise<void>
    try {
      copied =
        typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write
          ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': url.then((u) => new Blob([u], { type: 'text/plain' })) })])
          : url.then((u) => navigator.clipboard.writeText(u))
    } catch (e) {
      copied = Promise.reject(e)
    }
    void link.then(
      (l) =>
        copied.then(
          () => setCopyNote({ id: a.id, text: 'Link copied. Paste it into a message to the guest, or send it below.', url: l.url }),
          // The browser wouldn't let us copy: show the link right here instead.
          () => setCopyNote({ id: a.id, text: 'Your browser didn’t allow copying automatically. Here’s the new link:', url: l.url, showUrl: true }),
        ),
      () => {}, // the error shows above the table
    )
  }
  const revoke = useMutation({
    mutationFn: (a: AttendeeRowView) => post(`${orgApi(orgSlug)}/attendees/${a.id}/revoke`),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (a: AttendeeRowView) => del(`${orgApi(orgSlug)}/attendees/${a.id}`),
    onSuccess: refresh,
  })
  // Someone who joined by the group link was really a guest (their review can then be published).
  const confirmGuest = useMutation({
    mutationFn: (a: AttendeeRowView) => post(`${orgApi(orgSlug)}/attendees/${a.id}/confirm-guest`),
    onSuccess: refresh,
  })
  // A guest who has sent a review: removed with everything they sent (the same erasure as the Privacy page).
  const erase = useMutation({
    mutationFn: (a: AttendeeRowView) => post(`${orgApi(orgSlug)}/attendees/${a.id}/erase`, { confirm: 'DELETE', reason: 'Removed from the guest list' }),
    onSuccess: refresh,
  })
  function removeWithReview(a: AttendeeRowView) {
    void confirm({
      title: `Remove ${a.name} and their review?`,
      message: (
        <>
          <p>
            Everything {a.name} sent is deleted for good: their story (taken down if it’s published), private feedback and photos, including any in
            the album. Their link stops working.
          </p>
          <p>This can’t be undone. To keep their review but stop their link, use Revoke instead.</p>
        </>
      ),
      confirmLabel: 'Remove guest and review',
      danger: true,
      typeToConfirm: 'DELETE',
    }).then((ok) => ok && erase.mutate(a))
  }
  // Croot emails the links itself; copying them is the fallback.
  const [sentNote, setSentNote] = useState<string | null>(null)
  const emailAll = useMutation({
    mutationFn: () => post<{ sent: number; failed: string[]; stopped?: string | null; notYet?: number }>(`${base}/invites/email-all`),
    onSuccess: (r) => {
      setSentNote(
        `Emailed ${r.sent} invitation${r.sent === 1 ? '' : 's'}.${r.failed.length ? ` Couldn’t email: ${r.failed.join(', ')}.` : ''}` +
          (r.stopped ? ` ${r.notYet ?? 0} not sent yet: ${r.stopped}` : ''),
      )
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
    attendees.data?.filter((a) => a.email && !(a.invitation?.emailedAt && !a.invitation.revoked) && !['submitted', 'consented', 'published', 'withdrawn'].includes(a.state)).length ?? 0

  // Copied-but-not-sent links can't be shown again, so warn before leaving with them on screen.
  useEffect(() => {
    if (!issued.length) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [issued.length])

  const withoutLink = attendees.data?.filter((a) => !a.invitation).length ?? 0
  const allLinksText = issued.map((l) => `${l.name}\t${l.email ?? 'no email'}\t${l.url}`).join('\n')
  const rowError = issue.error || revoke.error || remove.error || erase.error || confirmGuest.error || emailOne.error || emailAll.error

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
                void confirm({
                  title: `Email an invitation to ${toEmail} guest${toEmail === 1 ? '' : 's'}?`,
                  message: 'Each gets their own private link.',
                  confirmLabel: 'Send invitations',
                }).then((ok) => ok && emailAll.mutate())
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
                      {a.email ? <div className="small muted">{a.email}</div> : <AddEmail orgSlug={orgSlug} attendee={a} onAdded={refresh} />}
                      {a.emailProblem && <EmailProblem orgSlug={orgSlug} attendee={a} onFixed={refresh} />}
                      {(a.verified || a.source === 'group_link') && (
                        <div className="row small" style={{ gap: '0.35rem', marginTop: '0.25rem' }}>
                          {a.verified && (
                            <span className="review-badge is-verified" style={{ marginLeft: 0 }}>
                              <span aria-hidden="true">✓</span> Verified email
                            </span>
                          )}
                          {a.source === 'group_link' &&
                            (a.guestConfirmed ? (
                              <span className="review-badge" style={{ marginLeft: 0 }}>
                                Joined by group link
                              </span>
                            ) : (
                              <>
                                <span className="review-badge" style={{ marginLeft: 0 }}>
                                  Joined by group link · not confirmed
                                </span>
                                <button type="button" className="link-button" disabled={confirmGuest.isPending} onClick={() => confirmGuest.mutate(a)}>
                                  Confirm they were your guest
                                </button>
                              </>
                            ))}
                        </div>
                      )}
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
                        {a.email && (
                          <button type="button" className="btn secondary small" disabled={!collecting || emailOne.isPending} onClick={() => emailOne.mutate(a)}>
                            {a.invitation?.emailedAt ? 'Email again' : 'Email invitation'}
                          </button>
                        )}
                        <button type="button" className="btn ghost small" disabled={issue.isPending} onClick={() => copyLink(a)}>
                          {issue.isPending && issue.variables?.id === a.id
                            ? 'Copying…'
                            : !a.email && a.responseId
                              ? 'Copy a link to make changes'
                              : a.invitation && !a.invitation.revoked
                                ? 'Copy a new link'
                                : 'Copy a link'}
                        </button>
                        {a.invitation && !a.invitation.revoked && (
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={revoke.isPending}
                            onClick={() => {
                              void confirm({ title: `Revoke ${a.name}’s link?`, message: 'It stops working straight away. Anything they’ve written is kept.', confirmLabel: 'Revoke link', danger: true }).then(
                                (ok) => ok && revoke.mutate(a),
                              )
                            }}
                          >
                            Revoke
                          </button>
                        )}
                        {a.responseId && (
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={!isOwner || erase.isPending}
                            title={isOwner ? undefined : 'Only the organisation’s owner can remove a guest who has sent a review'}
                            onClick={() => removeWithReview(a)}
                          >
                            Remove
                          </button>
                        )}
                        {!a.responseId && (
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={remove.isPending}
                            onClick={() => {
                              void confirm({ title: `Remove ${a.name} from this programme?`, message: 'Any unsent draft is deleted.', confirmLabel: 'Remove guest', danger: true }).then(
                                (ok) => ok && remove.mutate(a),
                              )
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {copyNote?.id === a.id && (
                        <p className="small" role="status" style={{ margin: '0.4rem 0 0', color: copyNote.text.startsWith('Link copied') ? 'var(--ok, inherit)' : undefined }}>
                          {copyNote.text}
                        </p>
                      )}
                      {copyNote?.id === a.id && copyNote.url && copyNote.showUrl && (
                        <div className="row" style={{ gap: '0.4rem', marginTop: '0.3rem', flexWrap: 'nowrap' }}>
                          <label className="sr-only" htmlFor={`row-link-${a.id}`}>
                            New invitation link for {a.name}
                          </label>
                          <input id={`row-link-${a.id}`} type="text" readOnly value={copyNote.url} className="mono-input" autoFocus onFocus={(e) => e.currentTarget.select()} />
                          <CopyButton text={copyNote.url} />
                        </div>
                      )}
                      {copyNote?.id === a.id && copyNote.url && <ShareLink name={a.name} url={copyNote.url} retreatTitle={retreat.title} />}
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
      <GroupLinkCard orgSlug={orgSlug} retreat={retreat} />
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
            ? 'Columns: name, email, and optionally check-in and check-out dates (2026-10-23 or 23/10/2026). Email can be left blank for guests you’ll send their link another way. A header row is optional.'
            : 'Columns: name, email. Email can be left blank for guests you’ll send their link another way (WhatsApp, QR code). A header row is optional. The list itself is not stored.'
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
          placeholder={isProperty ? 'name,email,check-in,check-out\nAsha Patel,asha@example.com,2026-10-23,2026-10-30\nRavi Kumar,,2026-10-25,2026-10-31' : 'name,email\nAsha Patel,asha@example.com\nRavi Kumar,'}
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
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  async function submit(e: FormEvent) {
    e.preventDefault()
    setAdded(null)
    // Without an email nothing tells two guests apart, so check before adding a second with the same name.
    if (!form.email.trim()) {
      const list = queryClient.getQueryData<AttendeeRowView[]>(['admin', orgSlug, 'attendees', retreat.id]) ?? []
      const name = form.name.trim().toLowerCase()
      if (
        name &&
        list.some((a) => a.name.trim().toLowerCase() === name) &&
        !(await confirm({ title: `There’s already a guest called ${form.name.trim()}`, message: 'Add another guest with the same name? Each gets their own link.', confirmLabel: 'Add another' }))
      ) {
        return
      }
    }
    add.mutate()
  }
  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby="add-title">
      <h2 id="add-title">Add one guest</h2>
      <Field id="add-name" label="Name" error={fieldError(add.error, 'name')}>
        <input id="add-name" type="text" value={form.name} onChange={set('name')} />
      </Field>
      <Field id="add-email" label="Email (optional)" hint="Without one, copy their link and send it on WhatsApp or show a QR code." error={fieldError(add.error, 'email')}>
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

/** A guest's address bounced (or they reported spam): say so, and let the organiser correct it. */
/** A guest added without an email: say so, and let the organiser add one later. */
function AddEmail({ orgSlug, attendee, onAdded }: { orgSlug: string; attendee: AttendeeRowView; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const save = useMutation({
    mutationFn: () => patch(`${orgApi(orgSlug)}/attendees/${attendee.id}`, { email }),
    onSuccess: onAdded,
  })
  if (!open) {
    return (
      <div className="small muted">
        No email: send their link on WhatsApp or by QR code.{' '}
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Add email
        </button>{' '}
        so they can sign in to manage their review.
      </div>
    )
  }
  return (
    <form
      className="small"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <span className="row" style={{ gap: '0.35rem', marginTop: '0.3rem' }}>
        <label className="sr-only" htmlFor={`add-email-${attendee.id}`}>Email address for {attendee.name}</label>
        <input id={`add-email-${attendee.id}`} type="email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} style={{ minHeight: 32, maxWidth: '16rem' }} />
        <button type="submit" className="btn secondary small" disabled={save.isPending || !email.trim()}>
          Save email
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
      <MutationError error={save.error} />
    </form>
  )
}

function EmailProblem({ orgSlug, attendee, onFixed }: { orgSlug: string; attendee: AttendeeRowView; onFixed: () => void }) {
  const [email, setEmail] = useState(attendee.email ?? '')
  const fix = useMutation({
    mutationFn: () => patch<{ attendee: { emailProblem: string | null } }>(`${orgApi(orgSlug)}/attendees/${attendee.id}`, { email }),
    onSuccess: onFixed,
  })
  if (attendee.emailProblem === 'complained') {
    return <div className="small email-problem">They reported our email as spam, so Croot won’t email them again. Share their link another way.</div>
  }
  return (
    <form
      className="small email-problem"
      onSubmit={(e) => {
        e.preventDefault()
        fix.mutate()
      }}
    >
      <span>Email bounced: this address doesn’t accept email. Check it with {attendee.name || 'them'}.</span>
      <span className="row" style={{ gap: '0.35rem', marginTop: '0.3rem' }}>
        <label className="sr-only" htmlFor={`fix-${attendee.id}`}>Correct email address for {attendee.name}</label>
        <input id={`fix-${attendee.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minHeight: 32, maxWidth: '16rem' }} />
        <button type="submit" className="btn secondary small" disabled={fix.isPending || email.trim().toLowerCase() === attendee.email}>
          Correct address
        </button>
      </span>
      <MutationError error={fix.error} />
    </form>
  )
}
