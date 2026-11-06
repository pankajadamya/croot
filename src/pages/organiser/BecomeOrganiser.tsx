import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { get, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { SignedInFrame, workspacePath } from '../../components/AppHeader'
import { OrganiserDetailsForm } from '../../components/OrganiserDetailsForm'
import { ErrorNotice, Loading } from '../../components/States'

interface RequestView {
  id: string
  status: 'pending' | 'approved' | 'declined'
  orgName: string
  declineReason: string | null
  createdAt: string
  reviewedAt: string | null
}

/** "Become an organiser": a signed-in person adds their details and starts straight away as the owner of a new organisation. */
export default function BecomeOrganiser() {
  const { session, loading, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const q = useQuery({
    enabled: Boolean(session),
    queryKey: ['organiser-request'],
    queryFn: () => get<{ request: RequestView | null; prefill: { contactName: string; phone: string } }>('/api/account/organiser-request'),
  })

  if (loading) return <Loading />
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />

  const isOrganiser = session.memberships.length > 0
  // Anyone not yet an organiser can start (a request declined before self-service included).
  const showForm = !isOrganiser && q.data

  return (
    <SignedInFrame session={session}>
      <main className="narrow" style={{ padding: '2.5rem 0 5rem' }}>
        <p className="eyebrow">For retreat organisers and property owners</p>
        <h1>Become an organiser</h1>
        {isOrganiser ? (
          <div className="notice ok">
            You’re already an organiser. <Link to={workspacePath(session)}>Open your organiser workspace</Link>.
          </div>
        ) : (
          <p className="muted" style={{ maxWidth: '62ch' }}>
            Organisers invite their guests to review a retreat or a stay, then publish the stories guests agree to share. Add a few details and you
            can start straight away: you’ll be the owner of your organisation and can invite your team.
          </p>
        )}
        {q.isLoading && <Loading />}
        {q.error && <ErrorNotice error={q.error} />}


        {showForm && (
          <section className="card" style={{ marginTop: '1rem' }}>
            <OrganiserDetailsForm
              email={session.user.email}
              initial={{ contactName: q.data!.prefill.contactName, phone: q.data!.prefill.phone }}
              submitLabel="Start as an organiser"
              onSubmit={async (details) => {
                const { organisation } = await post<{ organisation: { slug: string } }>('/api/account/organiser-request', details)
                await refresh()
                await qc.invalidateQueries({ queryKey: ['organiser-request'] })
                navigate(`/admin/${organisation.slug}`, { replace: true })
              }}
            />
          </section>
        )}
      </main>
    </SignedInFrame>
  )
}
