import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { Home } from './pages/public/Home'
import { NotFound } from './components/States'

// Code-split by audience: guests never download the organiser workspace.
const OrgHome = lazy(() => import('./pages/public/OrgHome'))
const RetreatLanding = lazy(() => import('./pages/public/RetreatLanding'))
const StoryPage = lazy(() => import('./pages/public/StoryPage'))
const AnonymousNote = lazy(() => import('./pages/public/AnonymousNote'))
const InviteFlow = lazy(() => import('./pages/attendee/InviteFlow'))
const Receipt = lazy(() => import('./pages/attendee/Receipt'))

const Login = lazy(() => import('./pages/admin/Login'))
const Setup = lazy(() => import('./pages/admin/Setup'))
const AdminHome = lazy(() => import('./pages/admin/AdminHome'))
const OrgDashboard = lazy(() => import('./pages/admin/OrgDashboard'))
const RetreatNew = lazy(() => import('./pages/admin/RetreatNew'))
const RetreatWorkspace = lazy(() => import('./pages/admin/RetreatWorkspace'))
const ResponseDetail = lazy(() => import('./pages/admin/ResponseDetail'))
const Team = lazy(() => import('./pages/admin/Team'))
const Audit = lazy(() => import('./pages/admin/Audit'))
const PlatformConsole = lazy(() => import('./pages/platform/PlatformConsole'))

export function App() {
  return (
    <Suspense fallback={<div className="container muted" style={{ padding: '3rem 0' }}>Loading…</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/o/:orgSlug" element={<OrgHome />} />
        <Route path="/o/:orgSlug/r/:retreatSlug" element={<RetreatLanding />} />
        <Route path="/o/:orgSlug/r/:retreatSlug/anonymous" element={<AnonymousNote />} />
        <Route path="/stories/:slug" element={<StoryPage />} />

        <Route path="/invite/:token" element={<InviteFlow />} />
        <Route path="/response/:token" element={<Receipt />} />

        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/setup/:token" element={<Setup />} />
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/:orgSlug" element={<OrgDashboard />} />
        <Route path="/admin/:orgSlug/retreats/new" element={<RetreatNew />} />
        <Route path="/admin/:orgSlug/retreats/:retreatId" element={<RetreatWorkspace />} />
        <Route path="/admin/:orgSlug/retreats/:retreatId/:tab" element={<RetreatWorkspace />} />
        <Route path="/admin/:orgSlug/responses/:responseId" element={<ResponseDetail />} />
        <Route path="/admin/:orgSlug/team" element={<Team />} />
        <Route path="/admin/:orgSlug/audit" element={<Audit />} />
        <Route path="/platform" element={<PlatformConsole />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
