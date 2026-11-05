import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { del, get, patch, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { MutationError } from '../admin/adminUi'
import { orgLabel } from './orgLabel'

interface Person {
  id: string
  email: string
  name: string
  isPlatformAdmin: boolean
  active: boolean
  emailVerified: boolean
  signInMethods: { google: boolean; password: boolean; emailCode: boolean }
  lastLoginAt: string | null
  createdAt: string
  memberships: Array<{ id: string; role: 'owner' | 'organiser'; organisation: { id: string; slug: string; name: string } }>
}

interface Org {
  id: string
  slug: string
  name: string
  ownerEmails: string[]
}

const PEOPLE_KEY = ['platform', 'people']

/**
 * Everyone signs in the same way. What they see afterwards comes from their account:
 * admin → this console; member of an organisation → the organiser workspace; otherwise a guest.
 */
export function People() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'organisers' | 'admins'>('all')
  const people = useQuery({
    queryKey: [...PEOPLE_KEY, q, filter],
    queryFn: () => get<{ users: Person[] }>(`/api/platform/users?q=${encodeURIComponent(q)}&filter=${filter}`).then((r) => r.users),
  })
  const orgs = useQuery({ queryKey: ['platform', 'orgs'], queryFn: () => get<{ orgs: Org[] }>('/api/platform/orgs').then((r) => r.orgs) })
  const refresh = () => qc.invalidateQueries({ queryKey: PEOPLE_KEY })

  return (
    <section className="card" aria-labelledby="pf-people">
      <h2 id="pf-people">People</h2>
      <p className="muted small" style={{ maxWidth: '70ch' }}>
        Everyone signs in the same way: email code, Google or password. Give someone a role in an organisation to make them an <strong>organiser</strong>,
        and they’ll see the organiser workspace next time they load the app. An <strong>admin</strong> can do everything here. Anyone without a
        role is a guest and sees only their own reviews.
      </p>
      <AddPerson onDone={refresh} />
      <div className="row" style={{ margin: '1rem 0' }}>
        <label htmlFor="people-q" className="sr-only">
          Search people
        </label>
        <input id="people-q" type="search" placeholder="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <label htmlFor="people-filter" className="sr-only">
          Show
        </label>
        <select id="people-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ maxWidth: 200 }}>
          <option value="all">Everyone</option>
          <option value="organisers">Organisers</option>
          <option value="admins">Admins</option>
        </select>
      </div>
      {people.isLoading && <Loading />}
      {people.error && <ErrorNotice error={people.error} />}
      {people.data?.length === 0 && <p className="muted">No one matches.</p>}
      <div className="stack">
        {people.data?.map((p) => (
          <PersonRow key={p.id} person={p} orgs={orgs.data ?? []} onChange={refresh} />
        ))}
      </div>
    </section>
  )
}

function AddPerson({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () => post<{ user: Person; existed: boolean }>('/api/platform/users', { email, name: name || undefined }),
    onSuccess: (r) => {
      setNotice(r.existed ? `${r.user.email} already has an account.` : `Account added for ${r.user.email}. Give them a role below; they sign in with an email code or Google.`)
      setEmail('')
      setName('')
      onDone()
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    add.mutate()
  }
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add someone who hasn’t signed in yet</summary>
      <form className="row" onSubmit={submit} style={{ marginTop: '0.75rem', alignItems: 'flex-end' }}>
        <Field id="add-email" label="Email">
          <input id="add-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="add-name" label="Name (optional)">
          <input id="add-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button className="btn small" disabled={add.isPending || !email} style={{ marginBottom: '1rem' }}>
          Add account
        </button>
      </form>
      {notice && (
        <div className="notice ok" role="status">
          {notice}
        </div>
      )}
      <MutationError error={add.error} />
    </details>
  )
}

function PersonRow({ person: p, orgs, onChange }: { person: Person; orgs: Org[]; onChange: () => void }) {
  const { session, refresh: refreshSession } = useAuth()
  const isMe = session?.user.id === p.id
  const [orgId, setOrgId] = useState('')
  const [newOrg, setNewOrg] = useState('')
  const [role, setRole] = useState<'owner' | 'organiser'>('organiser')
  const done = async () => {
    onChange()
    if (isMe) await refreshSession()
  }

  const grant = useMutation({
    mutationFn: () =>
      post(`/api/platform/users/${p.id}/memberships`, orgId === '__new' ? { newOrganisationName: newOrg, role: 'owner' } : { organisationId: orgId, role }),
    onSuccess: async () => {
      setOrgId('')
      setNewOrg('')
      await done()
    },
  })
  const revoke = useMutation({
    mutationFn: (membershipId: string) => del(`/api/platform/users/${p.id}/memberships/${membershipId}`),
    onSuccess: done,
  })
  const update = useMutation({
    mutationFn: (body: { isPlatformAdmin?: boolean; active?: boolean }) => patch(`/api/platform/users/${p.id}`, body),
    onSuccess: done,
  })

  const kind = p.isPlatformAdmin ? 'Admin' : p.memberships.length ? 'Organiser' : 'Guest'
  return (
    <article className="card tight" aria-label={p.email}>
      <div className="spread">
        <div>
          <strong>{p.name}</strong> <span className="muted">{p.email}</span>
          {isMe && <span className="small muted"> (you)</span>}
          <div className="row small" style={{ marginTop: '0.3rem' }}>
            <span className={`badge ${p.isPlatformAdmin ? 'ok' : p.memberships.length ? 'warn' : 'neutral'}`}>{kind}</span>
            {!p.active && <span className="badge danger">Disabled</span>}
            <span className="muted">
              {p.lastLoginAt ? `Last signed in ${formatDate(p.lastLoginAt)}` : 'Hasn’t signed in yet'}
              {p.emailVerified ? ' · email verified' : ''}
              {p.signInMethods.google ? ' · Google linked' : ''}
            </span>
          </div>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary small"
            disabled={update.isPending || (isMe && p.isPlatformAdmin)}
            onClick={() => {
              if (!p.isPlatformAdmin && !window.confirm(`Make ${p.email} an admin? They will be able to see and change every organisation.`)) return
              update.mutate({ isPlatformAdmin: !p.isPlatformAdmin })
            }}
          >
            {p.isPlatformAdmin ? 'Remove admin' : 'Make admin'}
          </button>
          {!isMe && (
            <button type="button" className="btn ghost small" disabled={update.isPending} onClick={() => update.mutate({ active: !p.active })}>
              {p.active ? 'Disable account' : 'Enable account'}
            </button>
          )}
        </div>
      </div>

      {p.memberships.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
          {p.memberships.map((m) => (
            <li key={m.id} className="row small" style={{ gap: '0.5rem' }}>
              <span className="badge">{m.role === 'owner' ? 'Owner' : 'Organiser'}</span>
              <Link to={`/admin/${m.organisation.slug}`}>{m.organisation.name}</Link>
              <button type="button" className="btn ghost small" disabled={revoke.isPending} onClick={() => revoke.mutate(m.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="row"
        style={{ marginTop: '0.75rem', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault()
          grant.mutate()
        }}
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={`org-${p.id}`} className="small">
            Make organiser of
          </label>
          <select id={`org-${p.id}`} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Choose an organisation…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {orgLabel(o)}
              </option>
            ))}
            <option value="__new">+ New organisation…</option>
          </select>
        </div>
        {orgId === '__new' ? (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`neworg-${p.id}`} className="small">
              New organisation name (they’ll be its owner)
            </label>
            <input id={`neworg-${p.id}`} type="text" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
          </div>
        ) : (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`role-${p.id}`} className="small">
              Role
            </label>
            <select id={`role-${p.id}`} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="organiser">Organiser</option>
              <option value="owner">Owner (can manage team and privacy)</option>
            </select>
          </div>
        )}
        <button className="btn small" disabled={grant.isPending || !orgId || (orgId === '__new' && newOrg.trim().length < 2)}>
          Give access
        </button>
      </form>
      <MutationError error={grant.error || revoke.error || update.error} />
    </article>
  )
}
