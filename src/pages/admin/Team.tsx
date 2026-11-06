import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { del, get, orgApi, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDateTime } from '../../lib/format'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'
import { fieldError, MutationError, useOrgSummary } from './adminUi'
import { useConfirm } from '../../components/ConfirmDialog'

interface Member {
  id: string
  role: 'owner' | 'organiser'
  name: string
  email: string
  active: boolean
  hasPassword: boolean
  lastLoginAt: string | null
}

export default function Team() {
  const confirm = useConfirm()
  const { orgSlug = '' } = useParams()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const summary = useOrgSummary(orgSlug)
  const isOwner = summary.data?.org.role === 'owner'
  const key = ['admin', orgSlug, 'members']
  const members = useQuery({ queryKey: key, queryFn: () => get<{ members: Member[] }>(`${orgApi(orgSlug)}/members`).then((r) => r.members) })

  const [form, setForm] = useState({ name: '', email: '', role: 'organiser' as 'owner' | 'organiser' })
  const [added, setAdded] = useState<{ name: string; email: string; emailed: boolean } | null>(null)
  const add = useMutation({
    mutationFn: () => post<{ emailed: boolean }>(`${orgApi(orgSlug)}/members`, form),
    onSuccess: (r) => {
      setAdded({ name: form.name, email: form.email, emailed: r.emailed })
      setForm({ name: '', email: '', role: 'organiser' })
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`${orgApi(orgSlug)}/members/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setAdded(null)
    add.mutate()
  }

  return (
    <AdminShell orgSlug={orgSlug}>
      <h1>Team</h1>
      <p className="muted">Everyone here can review named responses and private feedback for every programme in this organisation. Only owners can add or remove people.</p>
      {members.isLoading && <Loading />}
      {members.error && <ErrorNotice error={members.error} />}
      <MutationError error={remove.error} />
      {members.data && (
        <div className="table-wrap card tight">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Account</th>
                <th scope="col">Last sign-in</th>
                {isOwner && (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    <div className="small muted">{m.email}</div>
                  </td>
                  <td>{m.role === 'owner' ? 'Owner' : 'Organiser'}</td>
                  <td>
                    {!m.active ? <span className="badge danger">Disabled</span> : m.lastLoginAt || m.hasPassword ? <span className="badge ok">Active</span> : <span className="badge warn">Not signed in yet</span>}
                  </td>
                  <td className="small">{m.lastLoginAt ? formatDateTime(m.lastLoginAt) : 'Never'}</td>
                  {isOwner && (
                    <td>
                      {m.email !== session?.user.email && (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={remove.isPending}
                          onClick={() => {
                            void confirm({ title: `Remove ${m.name} from this organisation?`, message: 'They lose access straight away.', confirmLabel: 'Remove', danger: true }).then((ok) => ok && remove.mutate(m.id))
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isOwner && (
        <form className="card" onSubmit={submit} noValidate style={{ marginTop: '2rem', maxWidth: 640 }}>
          <h2>Add a team member</h2>
          <p className="small muted">We’ll email them to say they’ve been added. They sign in with that email address: Croot sends them a one-time code, so there’s no password to set.</p>
          <Field id="tm-name" label="Name" error={fieldError(add.error, 'name')}>
            <input id="tm-name" type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field id="tm-email" label="Email" error={fieldError(add.error, 'email')}>
            <input id="tm-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field id="tm-role" label="Role" error={fieldError(add.error, 'role')}>
            <select id="tm-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'owner' | 'organiser' }))}>
              <option value="organiser">Organiser — runs programmes and reviews responses</option>
              <option value="owner">Owner — also manages the team</option>
            </select>
          </Field>
          <MutationError error={add.error} shownFields={['name', 'email', 'role']} />
          <button className="btn" type="submit" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add member'}
          </button>
        </form>
      )}
      {added && (
        <div style={{ marginTop: '1rem', maxWidth: 640 }}>
          <div className={`notice ${added.emailed ? 'ok' : 'warn'}`} role="status">
            {added.emailed
              ? `${added.name} is on the team. We’ve emailed ${added.email} with a link to sign in.`
              : `${added.name} is on the team, but the email to ${added.email} couldn’t be sent. Ask them to sign in at ${window.location.origin}/signin with that address.`}{' '}
            <button type="button" className="btn ghost small" onClick={() => setAdded(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  )
}
