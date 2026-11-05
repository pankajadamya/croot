import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router'
import { get, orgApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AppHeader } from '../../components/AppHeader'
import { Loading } from '../../components/States'

/**
 * Frame for every organiser and super admin page. The top bar is the shared AppHeader, the same one
 * My reviews uses. Sends signed-out visitors to sign in, remembering where they were going.
 */
export function AdminShell({ orgSlug, children }: { orgSlug?: string; children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  const isMember = Boolean(orgSlug && session?.memberships.some((m) => m.slug === orgSlug))
  // Super admins visiting an organisation they don't belong to: fetch its name for the header.
  const orgName = useQuery({
    enabled: Boolean(orgSlug && session && !isMember),
    queryKey: ['admin', orgSlug, 'summary'],
    queryFn: () => get<{ org: { name: string } }>(orgApi(orgSlug!)),
    select: (d) => d.org.name,
  })

  if (loading) {
    return (
      <div className="admin">
        <div className="container">
          <Loading />
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />

  const membership = orgSlug ? session.memberships.find((m) => m.slug === orgSlug) : undefined

  return (
    <div className="admin">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppHeader session={session} orgSlug={orgSlug} orgName={orgName.data} />
      <main id="main" className="container admin-main">
        {membership?.status === 'suspended' && (
          <div className="notice warn" role="status">
            This organisation is suspended. Contact the platform team to restore access.
          </div>
        )}
        {membership?.status === 'pending' && (
          <div className="notice warn" role="status">
            This organisation is awaiting approval. You can set everything up; invitations and public pages go live once it’s approved.
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
