import { Link, Navigate } from 'react-router'
import { useAuth } from '../../lib/auth'
import { Loading } from '../../components/States'
import { AdminShell } from './AdminShell'

/** Sends single-organisation users straight to their workspace; otherwise offers a choice. */
export default function AdminHome() {
  const { session, loading } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/admin/login" replace />
  if (session.memberships.length === 1 && !session.user.isPlatformAdmin) {
    return <Navigate to={`/admin/${session.memberships[0].slug}`} replace />
  }
  return (
    <AdminShell>
      <h1>Your organisations</h1>
      {session.memberships.length === 0 ? (
        <p className="muted">You are not a member of any organisation yet.</p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {session.memberships.map((m) => (
            <li key={m.slug} className="card tight spread">
              <div>
                <Link to={`/admin/${m.slug}`} style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  {m.name}
                </Link>
                <div className="small muted">{m.role === 'owner' ? 'Owner' : 'Organiser'}</div>
              </div>
              {m.status === 'suspended' && <span className="badge warn">Suspended</span>}
            </li>
          ))}
        </ul>
      )}
      {session.user.isPlatformAdmin && (
        <div className="card" style={{ marginTop: '2rem' }}>
          <h2>Platform</h2>
          <p className="muted">Approve tenant requests, manage organisations and custom domains.</p>
          <Link className="btn" to="/platform">
            Open the platform console
          </Link>
        </div>
      )}
    </AdminShell>
  )
}
