import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation } from 'react-router'
import { get, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
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

/** "Become an organiser": a signed-in person sends their details; an admin approves or declines. */
export default function BecomeOrganiser() {
  const { session, loading } = useAuth()
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
  const latest = q.data?.request
  const showForm = !isOrganiser && q.data && (!latest || latest.status === 'declined')

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
            Organisers invite their guests to review a retreat or a stay, then publish the stories guests agree to share. Tell us a little about you
            and the croot team will review your request, usually within a couple of working days. We’ll email you either way.
          </p>
        )}
        {q.isLoading && <Loading />}
        {q.error && <ErrorNotice error={q.error} />}

        {latest?.status === 'pending' && (
          <div className="card" role="status">
            <h2 style={{ fontSize: '1.3rem' }}>Request received</h2>
            <p style={{ margin: 0 }}>
              We received your request for <strong>{latest.orgName}</strong> on {formatDate(latest.createdAt)}. We’ll email {session.user.email} once
              it’s been reviewed.
            </p>
          </div>
        )}
        {latest?.status === 'declined' && (
          <div className="notice warn" style={{ marginBottom: '1.5rem' }}>
            Your request for {latest.orgName} was declined on {formatDate(latest.reviewedAt)}.
            {latest.declineReason && <> Note from the croot team: {latest.declineReason}</>} You can send a new request below.
          </div>
        )}

        {showForm && (
          <section className="card" style={{ marginTop: '1rem' }}>
            <OrganiserDetailsForm
              email={session.user.email}
              initial={{ contactName: q.data!.prefill.contactName, phone: q.data!.prefill.phone }}
              submitLabel="Send request"
              onSubmit={async (details) => {
                await post('/api/account/organiser-request', details)
                await qc.invalidateQueries({ queryKey: ['organiser-request'] })
              }}
            />
          </section>
        )}
      </main>
    </SignedInFrame>
  )
}
