import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { MutationError, OneTimeLinkNotice } from '../admin/adminUi'

interface Invite {
  id: string
  email: string
  organisationName: string | null
  role: 'owner' | 'organiser'
  createdAt: string
  expiresAt: string
  state: 'open' | 'accepted' | 'revoked' | 'expired'
}

const INVITES_KEY = ['platform', 'organiser-invites']
const STATE_BADGE: Record<Invite['state'], [string, string]> = {
  open: ['Waiting', 'warn'],
  accepted: ['Accepted', 'ok'],
  revoked: ['Revoked', 'neutral'],
  expired: ['Expired', 'neutral'],
}

/**
 * Invite someone to be an organiser: a one-time link for one email address. They sign in with that
 * address, fill in their details and are set up straight away, with no approval step.
 */
export function OrganiserInvites() {
  const qc = useQueryClient()
  const invites = useQuery({ queryKey: INVITES_KEY, queryFn: () => get<{ invites: Invite[] }>('/api/platform/organiser-invites').then((r) => r.invites) })
  const orgs = useQuery({ queryKey: ['platform', 'orgs'], queryFn: () => get<{ orgs: Array<{ id: string; name: string }> }>('/api/platform/orgs').then((r) => r.orgs) })
  const [email, setEmail] = useState('')
  const [organisationId, setOrganisationId] = useState('')
  const [role, setRole] = useState<'owner' | 'organiser'>('organiser')
  const [sendEmail, setSendEmail] = useState(true)
  const [created, setCreated] = useState<{ url: string; email: string; emailed: boolean } | null>(null)

  const create = useMutation({
    mutationFn: () =>
      post<{ url: string; emailed: boolean }>('/api/platform/organiser-invites', { email, sendEmail, ...(organisationId ? { organisationId, role } : {}) }),
    onSuccess: (r) => {
      setCreated({ url: r.url, email, emailed: r.emailed })
      setEmail('')
      void qc.invalidateQueries({ queryKey: INVITES_KEY })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => post(`/api/platform/organiser-invites/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setCreated(null)
    create.mutate()
  }

  return (
    <section className="card" aria-labelledby="pf-invites">
      <h2 id="pf-invites">Invite an organiser</h2>
      <p className="muted small" style={{ maxWidth: '70ch' }}>
        Creates a one-time link for one email address, valid for 14 days. They sign in with that address, fill in a few details and become an
        organiser straight away: of a new organisation they name, or of one you choose.
      </p>
      {created && (
        <OneTimeLinkNotice
          title={`Invitation for ${created.email}${created.emailed ? ' (also emailed to them)' : ''}. This link is shown once:`}
          url={created.url}
          onDismiss={() => setCreated(null)}
        />
      )}
      <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
        <Field id="inv-email" label="Email">
          <input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="inv-org" label="Organisation">
          <select id="inv-org" value={organisationId} onChange={(e) => setOrganisationId(e.target.value)}>
            <option value="">They create their own (as owner)</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                Join {o.name}
              </option>
            ))}
          </select>
        </Field>
        {organisationId && (
          <Field id="inv-role" label="Role">
            <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="organiser">Organiser</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
        )}
        <label className="row small" style={{ fontWeight: 400, marginBottom: '1.2rem' }}>
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the link to them
        </label>
        <button className="btn small" disabled={create.isPending || !email} style={{ marginBottom: '1rem' }}>
          Create invitation
        </button>
      </form>
      <MutationError error={create.error || revoke.error} />

      {invites.isLoading && <Loading />}
      {invites.error && <ErrorNotice error={invites.error} />}
      {invites.data && invites.data.length > 0 && (
        <details style={{ marginTop: '0.5rem' }} open={invites.data.some((i) => i.state === 'open')}>
          <summary style={{ cursor: 'pointer' }}>Invitations ({invites.data.length})</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">For</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.data.map((i) => {
                  const [label, tone] = STATE_BADGE[i.state]
                  return (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td className="small">{i.organisationName ? `${i.role === 'owner' ? 'Owner' : 'Organiser'} of ${i.organisationName}` : 'Their own organisation'}</td>
                      <td className="small">{formatDate(i.createdAt)}</td>
                      <td>
                        <span className={`badge ${tone}`}>{label}</span>
                      </td>
                      <td>
                        {i.state === 'open' && (
                          <button type="button" className="btn ghost small" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}
