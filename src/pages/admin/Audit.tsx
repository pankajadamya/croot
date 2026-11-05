import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { get, orgApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'

interface AuditEvent {
  id: string
  actorKind: string
  actorName: string
  action: string
  entityType: string
  entityId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

function describeMetadata(m: Record<string, unknown>): string {
  const entries = Object.entries(m ?? {})
  if (!entries.length) return ''
  return entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ')
}

export default function Audit() {
  const { orgSlug = '' } = useParams()
  const events = useQuery({
    queryKey: ['admin', orgSlug, 'audit'],
    queryFn: () => get<{ events: AuditEvent[] }>(`${orgApi(orgSlug)}/audit`).then((r) => r.events),
  })
  return (
    <AdminShell orgSlug={orgSlug}>
      <h1>Audit log</h1>
      <p className="muted">The latest 200 actions in this organisation: publications, consent-related changes, exports, invitations and team changes.</p>
      {events.isLoading && <Loading />}
      {events.error && <ErrorNotice error={events.error} />}
      {events.data && events.data.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      {events.data && events.data.length > 0 && (
        <div className="table-wrap card tight">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Item</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(e.createdAt)}
                  </td>
                  <td>
                    {e.actorName}
                    {e.actorKind !== 'user' && <div className="small muted">{e.actorKind}</div>}
                  </td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td className="small">
                    {e.entityType}
                    {e.entityId && <div className="muted">…{e.entityId.slice(-6)}</div>}
                  </td>
                  <td className="small">{describeMetadata(e.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  )
}
