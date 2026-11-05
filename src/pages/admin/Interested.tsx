import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { get, orgApi, post } from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/format'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'
import { MutationError } from './adminUi'

interface Interested {
  people: Array<{ id: string; email: string; name: string; confirmedAt: string; from: string | null }>
  pending: number
  lastSentAt: string | null
}

/** People who asked to hear about the next retreat: who they are, and an email to all of them. */
export default function InterestedPage() {
  const { orgSlug = '' } = useParams()
  const qc = useQueryClient()
  const key = ['admin', orgSlug, 'interest']
  const q = useQuery({ queryKey: key, queryFn: () => get<Interested>(`${orgApi(orgSlug)}/interest`) })
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () => post<{ sent: number; failed: number }>(`${orgApi(orgSlug)}/interest/notify`, { subject, message }),
    onSuccess: (r) => {
      setResult(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}${r.failed ? `; ${r.failed} couldn’t be sent` : ''}.`)
      setSubject('')
      setMessage('')
      void qc.invalidateQueries({ queryKey: key })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setResult(null)
    const n = q.data?.people.length ?? 0
    if (window.confirm(`Email ${n} ${n === 1 ? 'person' : 'people'} now?`)) send.mutate()
  }

  return (
    <AdminShell orgSlug={orgSlug}>
      <h1>Interested in your next retreat</h1>
      <p className="muted" style={{ maxWidth: '70ch' }}>
        People who used “Notify me” on your public pages and confirmed from the email we sent them. Every email you send here includes a link to
        unsubscribe, which deletes their address.
      </p>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNotice error={q.error} />}
      {q.data && (
        <div className="stack">
          <div className="card tight spread">
            <span>
              <strong>{q.data.people.length}</strong> confirmed{q.data.pending > 0 ? ` · ${q.data.pending} waiting to confirm` : ''}
              {q.data.lastSentAt && <span className="muted"> · last emailed {formatDateTime(q.data.lastSentAt)}</span>}
            </span>
            {q.data.people.length > 0 && (
              <a className="btn secondary small" href={`${orgApi(orgSlug)}/interest.csv`}>
                Export CSV
              </a>
            )}
          </div>

          {q.data.people.length > 0 && (
            <form className="card" onSubmit={submit} noValidate>
              <h2 style={{ marginTop: 0 }}>Email everyone</h2>
              <Field id="int-subject" label="Subject">
                <input id="int-subject" type="text" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Our next retreat is open for booking" />
              </Field>
              <Field id="int-message" label="Message" hint="Plain text. Links are clickable. An unsubscribe line is added at the end.">
                <textarea id="int-message" value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: '10rem' }} />
              </Field>
              <MutationError error={send.error} />
              {result && (
                <p className="notice ok" role="status">
                  {result}
                </p>
              )}
              <button className="btn" type="submit" disabled={send.isPending || subject.trim().length < 3 || message.trim().length < 10}>
                {send.isPending ? 'Sending…' : `Send to ${q.data.people.length}`}
              </button>
            </form>
          )}

          {q.data.people.length === 0 ? (
            <p className="muted">Nobody yet. The “Notify me” button is on your public retreat pages and your list of retreats.</p>
          ) : (
            <div className="table-wrap card tight">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Name</th>
                    <th scope="col">Signed up from</th>
                    <th scope="col">Confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.people.map((p) => (
                    <tr key={p.id}>
                      <td>{p.email}</td>
                      <td>{p.name || <span className="muted">—</span>}</td>
                      <td>{p.from ?? <span className="muted">Your retreats page</span>}</td>
                      <td>{formatDate(p.confirmedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AdminShell>
  )
}
