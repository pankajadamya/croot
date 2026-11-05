import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { del, get, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { REVIEW_KINDS, type ReviewKind } from '../../../shared/categories'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from '../admin/AdminShell'
import { fieldError, MutationError, OneTimeLinkNotice } from '../admin/adminUi'

interface TenantRequest {
  id: string
  orgName: string
  contactName: string
  email: string
  websiteUrl: string | null
  message: string | null
  reviewKinds?: ReviewKind[]
  status: 'pending' | 'approved' | 'declined'
  createdAt: string
}

interface Tenant {
  id: string
  slug: string
  name: string
  status: 'pending' | 'active' | 'suspended'
  createdAt: string
  domains: Array<{ id: string; hostname: string }>
  retreatCount: number
  memberCount: number
}

interface Created {
  organisation: { id: string; slug: string; name: string }
  setupUrl: string | null
}

const REQUESTS_KEY = ['platform', 'requests']
const ORGS_KEY = ['platform', 'orgs']

export default function PlatformConsole() {
  const { session } = useAuth()
  return (
    <AdminShell>
      <h1>Platform console</h1>
      {session && !session.user.isPlatformAdmin ? (
        <div className="notice error" role="alert">
          This area is for platform administrators only. <Link to="/admin">Go to your organisations</Link>.
        </div>
      ) : (
        <div className="stack">
          <Requests />
          <Tenants />
          <CreateTenant />
        </div>
      )}
    </AdminShell>
  )
}

function CreatedNotice({ created, onDismiss }: { created: Created; onDismiss: () => void }) {
  return created.setupUrl ? (
    <OneTimeLinkNotice title={`${created.organisation.name} is ready (/${created.organisation.slug}). Owner setup link:`} url={created.setupUrl} onDismiss={onDismiss} />
  ) : (
    <div className="notice ok" role="status">
      {created.organisation.name} created at /{created.organisation.slug}. The owner already has an account and can sign in.{' '}
      <button type="button" className="btn ghost small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function Requests() {
  const queryClient = useQueryClient()
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: () => get<{ requests: TenantRequest[] }>('/api/platform/tenant-requests').then((r) => r.requests) })
  const [slugs, setSlugs] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<Created | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY })
    void queryClient.invalidateQueries({ queryKey: ORGS_KEY })
  }
  const approve = useMutation({
    mutationFn: (id: string) => post<Created>(`/api/platform/tenant-requests/${id}/approve`, slugs[id]?.trim() ? { slug: slugs[id].trim() } : {}),
    onSuccess: (r) => {
      setCreated(r)
      refresh()
    },
  })
  const decline = useMutation({ mutationFn: (id: string) => post(`/api/platform/tenant-requests/${id}/decline`), onSuccess: refresh })
  const pending = requests.data?.filter((r) => r.status === 'pending') ?? []
  const handled = requests.data?.filter((r) => r.status !== 'pending') ?? []

  return (
    <section className="card" aria-labelledby="pf-requests">
      <h2 id="pf-requests">Tenant requests</h2>
      {created && <CreatedNotice created={created} onDismiss={() => setCreated(null)} />}
      <MutationError error={approve.error || decline.error} />
      {requests.isLoading && <Loading />}
      {requests.error && <ErrorNotice error={requests.error} />}
      {requests.data && pending.length === 0 && <p className="muted">No pending requests.</p>}
      {pending.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {pending.map((r) => (
            <li key={r.id} className="card tight">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>{r.orgName}</strong>
                  <div className="small muted">
                    {r.contactName} · {r.email} · {formatDate(r.createdAt)}
                  </div>
                  {r.websiteUrl && (
                    <div className="small">
                      <a href={r.websiteUrl} target="_blank" rel="noreferrer noopener">
                        {r.websiteUrl}
                      </a>
                    </div>
                  )}
                </div>
                <div className="row">
                  {(r.reviewKinds ?? []).map((k) => (
                    <span key={k} className="badge neutral">
                      {REVIEW_KINDS[k]?.label ?? k}
                    </span>
                  ))}
                </div>
              </div>
              {r.message && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.message}</p>}
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ marginBottom: 0, flex: '1 1 220px' }}>
                  <label htmlFor={`slug-${r.id}`}>Web address slug (optional)</label>
                  <input
                    id={`slug-${r.id}`}
                    type="text"
                    placeholder="Generated from the name"
                    value={slugs[r.id] ?? ''}
                    onChange={(e) => setSlugs((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                </div>
                <button type="button" className="btn" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
                  Approve
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={decline.isPending}
                  onClick={() => {
                    if (window.confirm(`Decline the request from ${r.orgName}?`)) decline.mutate(r.id)
                  }}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {handled.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary>Handled requests ({handled.length})</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Received</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {handled.map((r) => (
                  <tr key={r.id}>
                    <td>{r.orgName}</td>
                    <td className="small">
                      {r.contactName}
                      <div className="muted">{r.email}</div>
                    </td>
                    <td className="small">{formatDate(r.createdAt)}</td>
                    <td>
                      <span className={`badge ${r.status === 'approved' ? 'ok' : 'neutral'}`}>{r.status === 'approved' ? 'Approved' : 'Declined'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

function Tenants() {
  const queryClient = useQueryClient()
  const orgs = useQuery({ queryKey: ORGS_KEY, queryFn: () => get<{ orgs: Tenant[] }>('/api/platform/orgs').then((r) => r.orgs) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ORGS_KEY })
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: Tenant['status'] }) => post(`/api/platform/orgs/${v.id}/status`, { status: v.status }),
    onSuccess: refresh,
  })
  const removeDomain = useMutation({
    mutationFn: (v: { orgId: string; domainId: string }) => del(`/api/platform/orgs/${v.orgId}/domains/${v.domainId}`),
    onSuccess: refresh,
  })
  const erase = useMutation({
    mutationFn: (v: { id: string; confirmSlug: string }) => post(`/api/platform/orgs/${v.id}/erase`, { confirmSlug: v.confirmSlug }),
    onSuccess: refresh,
  })

  return (
    <section className="card" aria-labelledby="pf-tenants">
      <h2 id="pf-tenants">Tenants</h2>
      <MutationError error={setStatus.error || removeDomain.error || erase.error} />
      {orgs.isLoading && <Loading />}
      {orgs.error && <ErrorNotice error={orgs.error} />}
      {orgs.data && orgs.data.length === 0 && <p className="muted">No tenants yet.</p>}
      {orgs.data && orgs.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">Status</th>
                <th scope="col">Size</th>
                <th scope="col">Custom domains</th>
              </tr>
            </thead>
            <tbody>
              {orgs.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/admin/${o.slug}`} style={{ fontWeight: 600 }}>
                      {o.name}
                    </Link>
                    <div className="small muted">
                      /{o.slug} · since {formatDate(o.createdAt)}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${o.status === 'active' ? 'ok' : 'warn'}`}>{o.status === 'active' ? 'Active' : o.status === 'pending' ? 'Pending approval' : 'Suspended'}</span>
                    <div style={{ marginTop: '0.4rem' }}>
                      <button
                        type="button"
                        className="btn secondary small"
                        disabled={setStatus.isPending}
                        onClick={() => {
                          const next = o.status === 'active' ? 'suspended' : 'active'
                          if (next === 'active' || window.confirm(`Suspend ${o.name}? Its team will lose access to the workspace.`)) setStatus.mutate({ id: o.id, status: next })
                        }}
                      >
                        {o.status === 'active' ? 'Suspend' : o.status === 'pending' ? 'Approve' : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={erase.isPending}
                        onClick={() => {
                          const typed = window.prompt(
                            `Permanently delete ${o.name} and ALL of its guests' data and photos? Offer the owner their export first. This cannot be undone.\n\nType the slug "${o.slug}" to confirm:`,
                          )
                          if (typed !== null) erase.mutate({ id: o.id, confirmSlug: typed })
                        }}
                      >
                        Delete organisation…
                      </button>
                    </div>
                  </td>
                  <td className="small">
                    {o.retreatCount} {o.retreatCount === 1 ? 'programme' : 'programmes'}
                    <div>
                      {o.memberCount} {o.memberCount === 1 ? 'member' : 'members'}
                    </div>
                  </td>
                  <td>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem' }}>
                      {o.domains.map((d) => (
                        <li key={d.id} className="row small" style={{ gap: '0.4rem' }}>
                          <code>{d.hostname}</code>
                          <button
                            type="button"
                            className="btn ghost small"
                            aria-label={`Remove ${d.hostname}`}
                            disabled={removeDomain.isPending}
                            onClick={() => {
                              if (window.confirm(`Remove ${d.hostname}? Links on that domain will stop working.`)) removeDomain.mutate({ orgId: o.id, domainId: d.id })
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                    <AddDomain orgId={o.id} orgName={o.name} onDone={refresh} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AddDomain({ orgId, orgName, onDone }: { orgId: string; orgName: string; onDone: () => void }) {
  const [hostname, setHostname] = useState('')
  const add = useMutation({
    mutationFn: () => post(`/api/platform/orgs/${orgId}/domains`, { hostname }),
    onSuccess: () => {
      setHostname('')
      onDone()
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    add.mutate()
  }
  const err = fieldError(add.error, 'hostname')
  return (
    <form onSubmit={submit} noValidate className="row" style={{ gap: '0.4rem', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 180px' }}>
        <label htmlFor={`dom-${orgId}`} className="sr-only">
          New custom domain for {orgName}
        </label>
        <input id={`dom-${orgId}`} type="text" placeholder="reviews.example.com" value={hostname} onChange={(e) => setHostname(e.target.value)} aria-invalid={Boolean(add.error)} />
        {add.error && (
          <span className="small" role="alert" style={{ color: 'var(--danger)', display: 'block' }}>
            {err ?? (add.error as Error).message}
          </span>
        )}
      </div>
      <button type="submit" className="btn secondary small" disabled={!hostname.trim() || add.isPending}>
        Add domain
      </button>
    </form>
  )
}

function CreateTenant() {
  const queryClient = useQueryClient()
  const empty = { name: '', slug: '', ownerName: '', ownerEmail: '' }
  const [form, setForm] = useState(empty)
  const [created, setCreated] = useState<Created | null>(null)
  const create = useMutation({
    mutationFn: () => post<Created>('/api/platform/orgs', { ...form, slug: form.slug.trim() || undefined }),
    onSuccess: (r) => {
      setCreated(r)
      setForm(empty)
      void queryClient.invalidateQueries({ queryKey: ORGS_KEY })
    },
  })
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  function submit(e: FormEvent) {
    e.preventDefault()
    setCreated(null)
    create.mutate()
  }
  const err = (k: string) => fieldError(create.error, k)
  return (
    <section className="card" aria-labelledby="pf-create">
      <h2 id="pf-create">Create a tenant directly</h2>
      <p className="small muted">For organisers you’ve already spoken to. The owner gets a one-time setup link; no password is chosen for them.</p>
      <form onSubmit={submit} noValidate style={{ maxWidth: 640 }}>
        <Field id="ct-name" label="Organisation name" error={err('name')}>
          <input id="ct-name" type="text" value={form.name} onChange={set('name')} />
        </Field>
        <Field id="ct-slug" label="Web address slug (optional)" hint="Generated from the name if left blank." error={err('slug')}>
          <input id="ct-slug" type="text" value={form.slug} onChange={set('slug')} aria-describedby="ct-slug-hint" />
        </Field>
        <div className="grid-2">
          <Field id="ct-owner-name" label="Owner’s name" error={err('ownerName')}>
            <input id="ct-owner-name" type="text" value={form.ownerName} onChange={set('ownerName')} />
          </Field>
          <Field id="ct-owner-email" label="Owner’s email" error={err('ownerEmail')}>
            <input id="ct-owner-email" type="email" value={form.ownerEmail} onChange={set('ownerEmail')} />
          </Field>
        </div>
        <MutationError error={create.error} shownFields={['name', 'slug', 'ownerName', 'ownerEmail']} />
        <button className="btn" type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create tenant'}
        </button>
      </form>
      {created && (
        <div style={{ marginTop: '1rem' }}>
          <CreatedNotice created={created} onDismiss={() => setCreated(null)} />
        </div>
      )}
    </section>
  )
}
