import { Link, useParams } from 'react-router'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'
import { KindBadge, programmeDates, RETREAT_STATUS_LABELS, useOrgSummary } from './adminUi'
import type { RetreatStats } from './types'

const STAT_LABELS: Array<[keyof RetreatStats, string]> = [
  ['attendees', 'Invited'],
  ['opened', 'Opened link'],
  ['drafts', 'Drafts'],
  ['submitted', 'Submitted'],
  ['published', 'Published'],
  ['anonymousNotes', 'Anonymous notes'],
]

export default function OrgDashboard() {
  const { orgSlug = '' } = useParams()
  const summary = useOrgSummary(orgSlug)

  return (
    <AdminShell orgSlug={orgSlug}>
      {summary.isLoading && <Loading />}
      {summary.error && <ErrorNotice error={summary.error} />}
      {summary.data && (
        <>
          <div className="spread" style={{ marginBottom: '1.5rem' }}>
            <div>
              <p className="eyebrow">Organisation</p>
              <h1 style={{ margin: 0 }}>{summary.data.org.name}</h1>
            </div>
            <Link className="btn" to={`/admin/${orgSlug}/retreats/new`}>
              New programme
            </Link>
          </div>

          {summary.data.openChangeRequests > 0 && (
            <div className="notice warn" role="status">
              {summary.data.openChangeRequests === 1
                ? '1 guest has asked for a change to their response.'
                : `${summary.data.openChangeRequests} guests have asked for changes to their responses.`}{' '}
              Open a programme’s Responses tab to review them.
            </div>
          )}

          {summary.data.retreats.length === 0 ? (
            <div className="card">
              <h2>No programmes yet</h2>
              <p className="muted">Create an itinerary retreat or a retreat property to invite guests, collect their stories and private feedback, and publish a review site.</p>
              <Link className="btn" to={`/admin/${orgSlug}/retreats/new`}>
                Create your first programme
              </Link>
            </div>
          ) : (
            <div className="retreat-cards">
              {summary.data.retreats.map((r) => (
                <article key={r.id} className="card">
                  <div className="spread" style={{ alignItems: 'flex-start' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                      <Link to={`/admin/${orgSlug}/retreats/${r.id}`}>{r.title}</Link>
                    </h2>
                    <span className={`badge ${r.status === 'collecting' ? 'ok' : 'neutral'}`}>{RETREAT_STATUS_LABELS[r.status]}</span>
                  </div>
                  <div className="row" style={{ margin: '0.5rem 0' }}>
                    <KindBadge kind={r.kind} />
                    {programmeDates(r.startDate, r.endDate) && <span className="small muted">{programmeDates(r.startDate, r.endDate)}</span>}
                  </div>
                  <dl className="stats" style={{ margin: '1rem 0' }}>
                    {STAT_LABELS.map(([key, label]) => (
                      <div className="stat" key={key}>
                        <dt className="small muted">{label}</dt>
                        <dd style={{ margin: 0 }}>
                          <b>{r.stats[key]}</b>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="row">
                    <Link className="btn secondary small" to={`/admin/${orgSlug}/retreats/${r.id}/invitations`}>
                      Invitations
                    </Link>
                    <Link className="btn secondary small" to={`/admin/${orgSlug}/retreats/${r.id}/responses`}>
                      Responses
                    </Link>
                    <Link className="btn secondary small" to={`/admin/${orgSlug}/retreats/${r.id}/site`}>
                      Public site
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="row" style={{ marginTop: '2rem' }}>
            <Link to={`/admin/${orgSlug}/team`}>Manage the team</Link>
            <span aria-hidden="true">·</span>
            <Link to={`/admin/${orgSlug}/audit`}>View the audit log</Link>
          </div>
        </>
      )}
    </AdminShell>
  )
}
