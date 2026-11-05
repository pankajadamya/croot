import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { REVIEW_KINDS, type ReviewKind } from '../../../shared/categories'
import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate, formatRange } from '../../lib/format'
import { SignedInFrame } from '../../components/AppHeader'
import { ErrorNotice, Loading } from '../../components/States'
import { ReviewFlow } from './InviteFlow'

interface MyReview {
  attendeeId: string
  programme: string
  kind: ReviewKind
  organisation: string
  startDate: string | null
  endDate: string | null
  status: 'not_started' | 'draft' | 'submitted' | 'changes_requested' | 'withdrawn'
  submittedAt: string | null
  publication: 'none' | 'published' | 'unpublished' | 'withdrawn'
  storyUrl: string | null
}

const STATUS: Record<MyReview['status'], [string, string]> = {
  not_started: ['Not started', 'neutral'],
  draft: ['Draft saved', 'warn'],
  submitted: ['Sent', 'ok'],
  changes_requested: ['Being edited', 'warn'],
  withdrawn: ['Withdrawn', 'neutral'],
}

function useSignedIn() {
  const { session, loading, logout } = useAuth()
  const location = useLocation()
  return { session, loading, logout, redirect: <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace /> }
}

/** A signed-in guest's reviews, across every organiser that invited their email address. */
export default function MyReviews() {
  const { session, loading, redirect } = useSignedIn()
  const q = useQuery({
    enabled: Boolean(session),
    queryKey: ['my-reviews'],
    queryFn: () => get<{ reviews: MyReview[]; emailVerified: boolean }>('/api/me/reviews'),
  })
  if (loading) return <Loading />
  if (!session) return redirect

  const isAdmin = session.user.isPlatformAdmin
  const isOrganiser = session.memberships.length > 0

  return (
    <SignedInFrame session={session}>
      <main className="narrow" style={{ padding: '2.5rem 0 5rem' }}>
        <h1>My reviews</h1>
        <p className="muted">Signed in as {session.user.email}. Reviews you were invited to give with this address appear here.</p>
        {q.isLoading && <Loading />}
        {q.error && <ErrorNotice error={q.error} />}
        {q.data && !q.data.emailVerified && (
          <div className="notice warn">Sign in with an email code or Google to confirm this address before we can show reviews linked to it.</div>
        )}
        {q.data?.emailVerified && q.data.reviews.length === 0 && (
          <p className="notice">
            {isAdmin || isOrganiser
              ? 'You haven’t been invited to review a retreat with this address. Reviews you’re invited to give as a guest will appear here.'
              : 'There are no review invitations for this address. If your invitation went to a different email, sign in with that one.'}
          </p>
        )}
        <div className="stack" style={{ marginTop: '1.5rem' }}>
          {q.data?.reviews.map((r) => {
            const [label, tone] = STATUS[r.status]
            const action = r.status === 'submitted' ? 'View or edit' : r.status === 'withdrawn' ? 'View' : r.status === 'not_started' ? 'Start review' : 'Continue'
            return (
              <article key={r.attendeeId} className="card spread">
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    {r.organisation} · {REVIEW_KINDS[r.kind].short}
                  </p>
                  <h2 style={{ fontSize: '1.25rem', margin: '0.2rem 0' }}>{r.programme}</h2>
                  <p className="small muted" style={{ margin: 0 }}>
                    {formatRange(r.startDate, r.endDate)}
                    {r.submittedAt && ` · sent ${formatDate(r.submittedAt)}`}
                  </p>
                  <div className="row" style={{ marginTop: '0.4rem' }}>
                    <span className={`badge ${tone}`}>{label}</span>
                    {r.publication === 'published' && <span className="badge ok">Published</span>}
                    {r.storyUrl && (
                      <Link to={r.storyUrl} className="small">
                        See it live
                      </Link>
                    )}
                  </div>
                </div>
                <Link className="btn" to={`/my-reviews/${r.attendeeId}`}>
                  {action}
                </Link>
              </article>
            )
          })}
        </div>
      </main>
    </SignedInFrame>
  )
}

/** The same review form as the unique link, reached through sign-in. */
export function MyReviewFlow() {
  const { attendeeId = '' } = useParams()
  const { session, loading, redirect } = useSignedIn()
  if (loading) return <Loading />
  if (!session) return redirect
  return (
    <SignedInFrame session={session}>
      <ReviewFlow base={`/api/me/reviews/${attendeeId}`} viaSignIn />
    </SignedInFrame>
  )
}
