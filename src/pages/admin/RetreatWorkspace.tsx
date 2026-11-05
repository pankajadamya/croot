import { Link, useParams } from 'react-router'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'
import { CopyField, KindBadge, programmeDates, publicRetreatUrl, RETREAT_STATUS_LABELS, useRetreat } from './adminUi'
import { OverviewTab } from './workspace/OverviewTab'
import { InvitationsTab } from './workspace/InvitationsTab'
import { ResponsesTab } from './workspace/ResponsesTab'
import { AnonymousTab } from './workspace/AnonymousTab'
import { InsightsTab } from './workspace/InsightsTab'
import { SiteTab } from './workspace/SiteTab'
import { AppearanceTab } from './workspace/AppearanceTab'

const TABS = [
  ['overview', 'Overview'],
  ['invitations', 'Invitations'],
  ['responses', 'Responses'],
  ['anonymous', 'Anonymous notes'],
  ['insights', 'Insights'],
  ['site', 'Public site'],
  ['appearance', 'Appearance'],
] as const

type TabKey = (typeof TABS)[number][0]

export default function RetreatWorkspace() {
  const { orgSlug = '', retreatId = '', tab } = useParams()
  const retreat = useRetreat(orgSlug, retreatId)
  const active: TabKey | null = !tab ? 'overview' : (TABS.find(([k]) => k === tab)?.[0] ?? null)
  const base = `/admin/${orgSlug}/retreats/${retreatId}`

  return (
    <AdminShell orgSlug={orgSlug}>
      <p className="small">
        <Link to={`/admin/${orgSlug}`}>← Programmes</Link>
      </p>
      {retreat.isLoading && <Loading />}
      {retreat.error && <ErrorNotice error={retreat.error} />}
      {retreat.data && (
        <>
          <div className="spread" style={{ alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h1 style={{ margin: 0 }}>{retreat.data.title}</h1>
              <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                {[programmeDates(retreat.data.startDate, retreat.data.endDate), retreat.data.locationSummary].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="row">
              <KindBadge kind={retreat.data.kind} />
              <span className={`badge ${retreat.data.status === 'collecting' ? 'ok' : 'neutral'}`}>{RETREAT_STATUS_LABELS[retreat.data.status]}</span>
            </div>
          </div>

          <details className="card tight" style={{ marginBottom: '1.5rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Share links</summary>
            <div className="grid-2" style={{ marginTop: '1rem' }}>
              <CopyField label="Public review site" value={publicRetreatUrl(orgSlug, retreat.data.slug)} hint="Shows your opening and published guest stories." />
              <CopyField
                label="Anonymous note form"
                value={`${publicRetreatUrl(orgSlug, retreat.data.slug)}/anonymous`}
                hint="Anyone with this link can leave a note. It is never connected to a guest."
              />
            </div>
          </details>

          <nav className="tabs" aria-label="Retreat sections">
            {TABS.map(([key, label]) => (
              <Link key={key} to={key === 'overview' ? base : `${base}/${key}`} aria-current={active === key ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>

          {active === null && <ErrorNotice error={new Error('That section does not exist.')} />}
          {active === 'overview' && <OverviewTab orgSlug={orgSlug} retreat={retreat.data} />}
          {active === 'invitations' && <InvitationsTab orgSlug={orgSlug} retreat={retreat.data} />}
          {active === 'responses' && <ResponsesTab orgSlug={orgSlug} retreat={retreat.data} />}
          {active === 'anonymous' && <AnonymousTab orgSlug={orgSlug} retreat={retreat.data} />}
          {active === 'insights' && <InsightsTab orgSlug={orgSlug} retreat={retreat.data} />}
          {active === 'site' && <SiteTab orgSlug={orgSlug} retreat={retreat.data} />}
          {active === 'appearance' && <AppearanceTab orgSlug={orgSlug} retreat={retreat.data} />}
        </>
      )}
    </AdminShell>
  )
}
