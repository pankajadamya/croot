import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useConfirm } from '../../components/ConfirmDialog'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { REVIEW_KINDS, type ReviewKind } from '../../../shared/categories'
import { api, ApiError, get, post } from '../../lib/api'
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
  /** Sent but not yet "Verified email": the guest can say it's theirs. */
  canClaim?: boolean
  verified?: boolean
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
  const queryClient = useQueryClient()
  const claim = useMutation({
    mutationFn: (attendeeId: string) => post(`/api/me/reviews/${attendeeId}/claim`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-reviews'] }),
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
                    {r.verified && (
                      <span className="badge ok">
                        <span aria-hidden="true">✓</span> Verified email
                      </span>
                    )}
                  </div>
                  {r.canClaim && (
                    <p className="small" style={{ margin: '0.6rem 0 0' }}>
                      Is this review yours? Confirming shows it as <strong>✓ Verified email</strong>.{' '}
                      <button type="button" className="btn secondary small" disabled={claim.isPending} onClick={() => claim.mutate(r.attendeeId)}>
                        Yes, this review is mine
                      </button>
                    </p>
                  )}
                </div>
                <Link className="btn" to={`/my-reviews/${r.attendeeId}`}>
                  {action}
                </Link>
              </article>
            )
          })}
        </div>
        {!isOrganiser && !isAdmin && (
          <section className="panel-sage spread" style={{ marginTop: '2.5rem' }} aria-labelledby="become-organiser">
            <div>
              <h2 id="become-organiser" style={{ fontSize: '1.2rem', margin: 0 }}>
                Run retreats or a retreat property?
              </h2>
              <p className="small" style={{ margin: '0.3rem 0 0' }}>
                Become an organiser to collect reviews from your own guests.
              </p>
            </div>
            <Link className="btn secondary" to="/organiser/request">
              Become an organiser
            </Link>
          </section>
        )}
        <DeleteAccount email={session.user.email} />
      </main>
    </SignedInFrame>
  )
}

/** Delete my account: the sign-in identity only. Reviews stay with the organiser who invited the guest. */
function DeleteAccount({ email }: { email: string }) {
  const confirm = useConfirm()
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run() {
    const ok = await confirm({
      title: 'Delete your Croot account?',
      message: (
        <>
          <p>This deletes your account, your sign-ins and any organiser team access, straight away. It can’t be undone.</p>
          <p>
            Reviews you sent stay with the organiser who invited you. To withdraw or erase one, use its private response page, or contact that
            organiser.
          </p>
        </>
      ),
      confirmLabel: 'Delete my account',
      danger: true,
      typeToConfirm: email,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await api('DELETE', '/api/account', { confirmEmail: email })
      setSession(null)
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not delete your account')
      setBusy(false)
    }
  }
  return (
    <section style={{ marginTop: '3rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }} aria-labelledby='delete-account'>
      <h2 id='delete-account' style={{ fontSize: '1.1rem', margin: 0 }}>
        Delete my account
      </h2>
      <p className='small muted' style={{ margin: '0.3rem 0 0.8rem' }}>
        Removes your sign-in and team access. Reviews you sent stay with the organiser who invited you.
      </p>
      {error && (
        <p className='notice error small' role='alert'>
          {error}
        </p>
      )}
      <button type='button' className='btn danger small' disabled={busy} onClick={() => void run()}>
        {busy ? 'Deleting…' : 'Delete my account'}
      </button>
    </section>
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
