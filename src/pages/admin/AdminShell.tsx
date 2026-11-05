import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth'
import { Loading } from '../../components/States'

/**
 * Frame for every signed-in organiser and platform page: brand, organisation, navigation, user and
 * sign-out. Sends signed-out visitors to the login page, remembering where they were going.
 */
export function AdminShell({ orgSlug, children }: { orgSlug?: string; children: ReactNode }) {
  const { session, loading, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  if (loading) {
    return (
      <div className="admin">
        <div className="container">
          <Loading />
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />

  const membership = orgSlug ? session.memberships.find((m) => m.slug === orgSlug) : undefined

  async function signOut() {
    await logout()
    queryClient.clear()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="admin">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="admin-top">
        <div className="container">
          <div className="row">
            <Link className="brand" to="/admin">
              croot
            </Link>
            {orgSlug && (
              <span className="muted" style={{ fontWeight: 600 }}>
                {membership?.name ?? orgSlug}
              </span>
            )}
          </div>
          <nav aria-label="Workspace" className="admin-nav">
            {orgSlug && (
              <>
                <NavLink to={`/admin/${orgSlug}`} end>
                  Programmes
                </NavLink>
                <NavLink to={`/admin/${orgSlug}/team`}>Team</NavLink>
                <NavLink to={`/admin/${orgSlug}/audit`}>Audit log</NavLink>
              </>
            )}
            {session.memberships.length > 1 && (
              <NavLink to="/admin" end>
                Organisations
              </NavLink>
            )}
            {session.user.isPlatformAdmin && <NavLink to="/platform">Platform</NavLink>}
          </nav>
          <div className="row">
            <span className="small muted">{session.user.name}</span>
            <button type="button" className="btn secondary small" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="container admin-main">
        {membership?.status === 'suspended' && (
          <div className="notice warn" role="status">
            This organisation is suspended. Contact the platform team to restore access.
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
