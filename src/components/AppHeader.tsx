import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth, type Session } from '../lib/auth'

/** Where "Organiser workspace" leads: straight into the only organisation, or the chooser. */
export function workspacePath(session: Session) {
  return session.memberships.length === 1 ? `/admin/${session.memberships[0].slug}` : '/admin'
}

/**
 * The one top bar for every signed-in screen (organiser workspace, admin, My reviews), so the
 * same links sit in the same places everywhere:
 *   logo → home page · [org name] · Admin · Organiser workspace · My reviews · name · Sign out
 * Links appear only when the account has that access. Organisation screens add their own row below.
 */
export function AppHeader({ session, orgSlug, orgName }: { session: Session; orgSlug?: string; orgName?: string }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const membership = orgSlug ? session.memberships.find((m) => m.slug === orgSlug) : undefined
  const isOrganiser = session.memberships.length > 0

  async function signOut() {
    await logout()
    queryClient.clear()
    navigate('/signin', { replace: true })
  }

  return (
    <header className="admin-top">
      <div className="container">
        <div className="row">
          <Link className="brand" to="/" aria-label="Croot home page">
            <img className="brand-logo" src="/croot-logo.svg" alt="Croot" />
          </Link>
          {orgSlug && (
            <span className="muted" style={{ fontWeight: 600 }}>
              {membership?.name ?? orgName ?? orgSlug}
            </span>
          )}
        </div>
        <nav aria-label="Account" className="admin-nav">
          {session.user.isPlatformAdmin && <NavLink to="/platform">Admin</NavLink>}
          {/* Not `end`: stays highlighted on every page inside the workspace. */}
          {isOrganiser && <NavLink to={workspacePath(session)}>Organiser workspace</NavLink>}
          <NavLink to="/my-reviews">My reviews</NavLink>
        </nav>
        <div className="row">
          <span className="small muted">{session.user.name}</span>
          <button type="button" className="btn secondary small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
      {orgSlug && (
        <div className="container">
          <nav aria-label="Organisation" className="admin-nav admin-subnav">
            <NavLink to={`/admin/${orgSlug}`} end>
              Programmes
            </NavLink>
            <NavLink to={`/admin/${orgSlug}/team`}>Team</NavLink>
            <NavLink to={`/admin/${orgSlug}/privacy`}>Privacy</NavLink>
            <NavLink to={`/admin/${orgSlug}/audit`}>Audit log</NavLink>
            {session.memberships.length > 1 && (
              <NavLink to="/admin" end>
                Switch organisation
              </NavLink>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}

/** Frame for signed-in screens outside the organiser workspace (My reviews, a signed-in review). */
export function SignedInFrame({ session, children, className = 'calm' }: { session: Session; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppHeader session={session} />
      <div id="main">{children}</div>
    </div>
  )
}
