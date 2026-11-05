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
import { OrganiserInvites } from './OrganiserInvites'
import { People } from './People'
import { PlatformSettings } from './PlatformSettings'
import { ownerText } from './orgLabel'
import { useConfirm } from '../../components/ConfirmDialog'

interface TenantRequest {
  id: string
  orgName: string
  contactName: string
  email: string
  websiteUrl: string | null
  message: string | null
  phone: string | null
  country: string | null
  volume: string | null
  source: 'request' | 'invite'
  declineReason: string | null
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
  ownerEmails: string[]
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
      <h1>Admin</h1>
      {session && !session.user.isPlatformAdmin ? (
        <div className="notice error" role="alert">
          This area is for admins only. <Link to="/admin">Go to your organisations</Link>.
        </div>
      ) : (
        <div className="stack">
          {/* Jump straight to a section instead of scrolling one long page. */}
          <nav className="row small admin-jump" aria-label="Admin sections">
            <a href="#pf-requests">Organiser requests</a>
            <a href="#pf-invites">Invite links</a>
            <a href="#pf-people">People</a>
            <a href="#pf-tenants">Organisations</a>
            <a href="#pf-create">Create an organisation</a>
            <a href="#pf-settings">Limits</a>
          </nav>
          <Requests />
          <OrganiserInvites />
          <People />
          <Tenants />
          <CreateTenant />
          <PlatformSettings />
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
      Approved: {created.organisation.name} (/{created.organisation.slug}). We’ve emailed them; they sign in with their email or Google.{' '}
      <button type="button" className="btn ghost small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function Requests() {
  const queryClient = useQueryClient()
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: () => get<{ requests: TenantRequest[] }>('/api/platform/tenant-requests').then((r) => r.requests) })
  const orgs = useQuery({ queryKey: ORGS_KEY, queryFn: () => get<{ orgs: Tenant[] }>('/api/platform/orgs').then((r) => r.orgs) })
  const [created, setCreated] = useState<Created | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY })
    void queryClient.invalidateQueries({ queryKey: ORGS_KEY })
  }
  const pending = requests.data?.filter((r) => r.status === 'pending') ?? []
  const handled = requests.data?.filter((r) => r.status !== 'pending') ?? []

  return (
    <section className="card" aria-labelledby="pf-requests">
      <h2 id="pf-requests">Organiser requests</h2>
      <p className="muted small">
        People who signed up and asked to become organisers. <strong>Approve</strong> creates their organisation, makes them its owner and emails
        them. <strong>Decline</strong> asks for a reason, which is included in the email to them.
      </p>
      {created && <CreatedNotice created={created} onDismiss={() => setCreated(null)} />}
      {requests.isLoading && <Loading />}
      {requests.error && <ErrorNotice error={requests.error} />}
      {requests.data && pending.length === 0 && <p className="muted">No pending requests.</p>}
      {pending.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {pending.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              sameNameOrgs={(orgs.data ?? []).filter((o) => o.name.trim().toLowerCase() === r.orgName.trim().toLowerCase())}
              onApproved={(c) => {
                setCreated(c)
                refresh()
              }}
              onDeclined={refresh}
            />
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
                  <th scope="col">How</th>
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
                    <td className="small">{r.source === 'invite' ? 'Invite link' : 'Request'}</td>
                    <td>
                      <span className={`badge ${r.status === 'approved' ? 'ok' : 'neutral'}`}>{r.status === 'approved' ? 'Approved' : 'Declined'}</span>
                      {r.declineReason && <div className="small muted">{r.declineReason}</div>}
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

/** One pending request: its details, then Approve, or Decline with a reason. */
function RequestCard({
  request: r,
  sameNameOrgs,
  onApproved,
  onDeclined,
}: {
  request: TenantRequest
  sameNameOrgs: Tenant[]
  onApproved: (c: Created) => void
  onDeclined: () => void
}) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const approve = useMutation({ mutationFn: () => post<Created>(`/api/platform/tenant-requests/${r.id}/approve`, {}), onSuccess: onApproved })
  const decline = useMutation({ mutationFn: () => post(`/api/platform/tenant-requests/${r.id}/decline`, { reason }), onSuccess: onDeclined })

  return (
    <li className="card tight">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>{r.orgName}</strong>
          <div className="small muted">
            {r.contactName} · {r.email}
            {r.phone && <> · {r.phone}</>}
            {r.country && <> · {r.country}</>} · {formatDate(r.createdAt)}
          </div>
          {r.websiteUrl && (
            <div className="small">
              <a href={r.websiteUrl} target="_blank" rel="noreferrer noopener">
                {r.websiteUrl}
              </a>
            </div>
          )}
          {r.volume && <div className="small">Scale: {r.volume}</div>}
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
      {sameNameOrgs.length > 0 && (
        <p className="notice small" style={{ margin: '0.75rem 0' }}>
          {sameNameOrgs.length === 1 ? 'An organisation' : `${sameNameOrgs.length} organisations`} with this name already exist
          {sameNameOrgs.length === 1 ? 's' : ''}: {sameNameOrgs.map((o) => `“${o.name}” (${ownerText(o)})`).join(', ')}. Names can repeat, so
          approving creates a separate organisation owned by {r.email}. If {r.contactName} belongs to the existing one instead, decline with a
          note and give them a role from <strong>People</strong> below.
        </p>
      )}

      {!declining ? (
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn" disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" className="btn secondary" onClick={() => setDeclining(true)}>
            Decline
          </button>
        </div>
      ) : (
        <form
          className="stack"
          style={{ marginTop: '0.75rem' }}
          onSubmit={(e) => {
            e.preventDefault()
            decline.mutate()
          }}
        >
          <Field id={`reason-${r.id}`} label="Reason for declining" hint={`Included in the email to ${r.contactName}.`}>
            <textarea id={`reason-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: '4.5rem' }} autoFocus />
          </Field>
          <div className="row">
            <button className="btn danger" disabled={decline.isPending || !reason.trim()}>
              {decline.isPending ? 'Sending…' : 'Send decline'}
            </button>
            <button type="button" className="btn secondary" onClick={() => setDeclining(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <MutationError error={approve.error || decline.error} />
    </li>
  )
}

function Tenants() {
  const confirm = useConfirm()
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
      <h2 id="pf-tenants">Organisations</h2>
      <MutationError error={setStatus.error || removeDomain.error || erase.error} />
      {orgs.isLoading && <Loading />}
      {orgs.error && <ErrorNotice error={orgs.error} />}
      {orgs.data && orgs.data.length === 0 && <p className="muted">No organisations yet.</p>}
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
                    <div className="small">{o.ownerEmails.length ? `Owner: ${o.ownerEmails.join(', ')}` : 'No owner'}</div>
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
                          if (next === 'active') setStatus.mutate({ id: o.id, status: next })
                          else
                            void confirm({ title: `Suspend ${o.name}?`, message: 'Its team will lose access to the workspace.', confirmLabel: 'Suspend', danger: true }).then(
                              (ok) => ok && setStatus.mutate({ id: o.id, status: next }),
                            )
                        }}
                      >
                        {o.status === 'active' ? 'Suspend' : o.status === 'pending' ? 'Approve' : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={erase.isPending}
                        onClick={() => {
                          void confirm({
                            title: `Permanently delete ${o.name}?`,
                            message: 'This deletes the organisation and ALL of its guests’ data and photos. Offer the owner their export first. This can’t be undone.',
                            confirmLabel: 'Delete organisation',
                            danger: true,
                            typeToConfirm: o.slug,
                          }).then((ok) => ok && erase.mutate({ id: o.id, confirmSlug: o.slug }))
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
                              void confirm({ title: `Remove ${d.hostname}?`, message: 'Links on that domain will stop working.', confirmLabel: 'Remove domain', danger: true }).then(
                                (ok) => ok && removeDomain.mutate({ orgId: o.id, domainId: d.id }),
                              )
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
      <h2 id="pf-create">Create an organisation directly</h2>
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
          {create.isPending ? 'Creating…' : 'Create organisation'}
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
