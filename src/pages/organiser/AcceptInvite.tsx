import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, get, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { OrganiserDetailsForm } from '../../components/OrganiserDetailsForm'
import { LinkUnavailable, Loading } from '../../components/States'

interface InviteView {
  email: string
  organisation: { name: string } | null
  role: 'owner' | 'organiser'
  expiresAt: string
  signedInAs: string | null
  matches: boolean
}

/**
 * /organiser/invite/:token: an admin's invite for one email address. The person signs in with that
 * address (a forwarded link is useless to anyone else), adds their details and becomes an organiser.
 */
export default function AcceptInvite() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { session, loading, refresh, logout } = useAuth()
  const here = `/organiser/invite/${token}`
  const q = useQuery({
    enabled: !loading,
    queryKey: ['organiser-invite', token, session?.user.id ?? null],
    queryFn: () => get<InviteView>(`/api/organiser-invites/${token}`),
    retry: false,
  })

  if (loading || q.isLoading) return <Loading />
  if (q.error) return <LinkUnavailable message={q.error instanceof ApiError ? q.error.message : 'This invitation could not be opened.'} />
  const inv = q.data!
  const joining = inv.organisation?.name

  return (
    <main className="calm">
      <div className="narrow" style={{ padding: '3rem 0 5rem' }}>
        <Link to="/" className="brand" aria-label="croot home page">
          <img className="brand-logo" src="/croot-logo.svg" alt="Croot" />
        </Link>
        <p className="eyebrow" style={{ marginTop: '2rem' }}>
          Organiser invitation
        </p>
        <h1>{joining ? `Join ${joining} on croot` : 'You’re invited to be an organiser'}</h1>
        <p className="muted" style={{ maxWidth: '62ch' }}>
          {joining
            ? `You’ll be ${inv.role === 'owner' ? 'an owner' : 'an organiser'} of ${joining}, able to invite guests to review and publish the stories they share.`
            : 'As an organiser you’ll invite your guests to review a retreat or a stay, and publish the stories they agree to share.'}{' '}
          This invitation is for <strong>{inv.email}</strong> and expires on {formatDate(inv.expiresAt)}.
        </p>

        {!session && (
          <div className="card">
            <p>First, sign in with {inv.email}. We’ll send a code to that address, or you can use Google if it’s a Google account.</p>
            <Link className="btn" to={`/signin?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(here)}`}>
              Sign in as {inv.email}
            </Link>
          </div>
        )}

        {session && !inv.matches && (
          <div className="notice warn">
            You’re signed in as {session.user.email}, but this invitation is for {inv.email}.{' '}
            <button
              type="button"
              className="btn ghost small"
              onClick={async () => {
                await logout()
                navigate(`/signin?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(here)}`)
              }}
            >
              Sign out and sign in as {inv.email}
            </button>
          </div>
        )}

        {session && inv.matches && (
          <section className="card">
            <h2 style={{ fontSize: '1.3rem' }}>A few details about you</h2>
            <OrganiserDetailsForm
              email={session.user.email}
              initial={{ contactName: session.user.name, orgName: joining ?? '' }}
              orgNameLabel={joining ? 'Your business name' : 'Organisation or business name'}
              orgNameHint={joining ? `You’ll join ${joining}.` : 'This becomes your organisation on croot. You can change it later.'}
              submitLabel={joining ? `Join ${joining}` : 'Become an organiser'}
              onSubmit={async (details) => {
                const r = await post<{ organisation: { slug: string } }>(`/api/organiser-invites/${token}/accept`, details)
                await refresh()
                navigate(`/admin/${r.organisation.slug}`, { replace: true })
              }}
            />
          </section>
        )}
      </div>
    </main>
  )
}
