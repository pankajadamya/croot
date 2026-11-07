import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { Home } from './pages/public/Home'
import { NotFound } from './components/States'
import { ScrollToHash } from './components/ScrollToHash'
import { usePageAnalytics } from './lib/analytics'

// Code-split by audience: guests never download the organiser workspace.
const OrgHome = lazy(() => import('./pages/public/OrgHome'))
const RetreatLanding = lazy(() => import('./pages/public/RetreatLanding'))
const StoryPage = lazy(() => import('./pages/public/StoryPage'))
const PrivacyNotice = lazy(() => import('./pages/public/PrivacyNotice'))
const Legal = lazy(() => import('./pages/public/Legal'))
const VerifyReviewPage = lazy(() => import('./pages/attendee/VerifyReviewPage'))
const GroupJoinPage = lazy(() => import('./pages/attendee/GroupJoinPage'))
const AdminPrivacy = lazy(() => import('./pages/admin/Privacy'))
const InviteFlow = lazy(() => import('./pages/attendee/InviteFlow'))
const Receipt = lazy(() => import('./pages/attendee/Receipt'))
const InviteAlbumPage = lazy(() => import('./pages/attendee/AlbumPage'))
const ReceiptAlbumPage = lazy(() => import('./pages/attendee/AlbumPage').then((m) => ({ default: m.ReceiptAlbumPage })))
const SignedInAlbumPage = lazy(() => import('./pages/attendee/AlbumPage').then((m) => ({ default: m.SignedInAlbumPage })))
const InterestLink = lazy(() => import('./pages/public/InterestLink'))
const SharedAlbumPage = lazy(() => import('./pages/attendee/AlbumPage').then((m) => ({ default: m.SharedAlbumPage })))

const SignIn = lazy(() => import('./pages/SignIn'))
const MyReviews = lazy(() => import('./pages/attendee/MyReviews'))
const BecomeOrganiser = lazy(() => import('./pages/organiser/BecomeOrganiser'))
const AcceptOrganiserInvite = lazy(() => import('./pages/organiser/AcceptInvite'))
const MyReviewFlow = lazy(() => import('./pages/attendee/MyReviews').then((m) => ({ default: m.MyReviewFlow })))
const Setup = lazy(() => import('./pages/admin/Setup'))
const AdminHome = lazy(() => import('./pages/admin/AdminHome'))
const OrgDashboard = lazy(() => import('./pages/admin/OrgDashboard'))
const RetreatNew = lazy(() => import('./pages/admin/RetreatNew'))
const RetreatWorkspace = lazy(() => import('./pages/admin/RetreatWorkspace'))
const ResponseDetail = lazy(() => import('./pages/admin/ResponseDetail'))
const Team = lazy(() => import('./pages/admin/Team'))
const Audit = lazy(() => import('./pages/admin/Audit'))
const Interested = lazy(() => import('./pages/admin/Interested'))
const PlatformConsole = lazy(() => import('./pages/platform/PlatformConsole'))

export function App() {
  usePageAnalytics()
  return (
    <Suspense fallback={<div className="container muted" style={{ padding: '3rem 0' }}>Loading…</div>}>
      <ScrollToHash />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/o/:orgSlug" element={<OrgHome />} />
        <Route path="/o/:orgSlug/r/:retreatSlug" element={<RetreatLanding />} />
        <Route path="/album/:token" element={<SharedAlbumPage />} />
        <Route path="/interest/:token" element={<InterestLink action="confirm" />} />
        <Route path="/interest/:token/unsubscribe" element={<InterestLink action="unsubscribe" />} />
        <Route path="/stories/:slug" element={<StoryPage />} />
        <Route path="/o/:orgSlug/privacy" element={<PrivacyNotice />} />
        <Route path="/legal/:doc" element={<Legal />} />
        <Route path="/verify/:token" element={<VerifyReviewPage />} />
        <Route path="/join/:token" element={<GroupJoinPage />} />

        <Route path="/invite/:token" element={<InviteFlow />} />
        <Route path="/invite/:token/album" element={<InviteAlbumPage />} />
        <Route path="/response/:token" element={<Receipt />} />
        <Route path="/response/:token/album" element={<ReceiptAlbumPage />} />

        <Route path="/signin" element={<SignIn />} />
        <Route path="/admin/login" element={<SignIn />} />
        <Route path="/my-reviews" element={<MyReviews />} />
        <Route path="/organiser/request" element={<BecomeOrganiser />} />
        <Route path="/organiser/invite/:token" element={<AcceptOrganiserInvite />} />
        <Route path="/my-reviews/:attendeeId" element={<MyReviewFlow />} />
        <Route path="/my-reviews/:attendeeId/album" element={<SignedInAlbumPage />} />
        <Route path="/admin/setup/:token" element={<Setup />} />
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/:orgSlug" element={<OrgDashboard />} />
        <Route path="/admin/:orgSlug/retreats/new" element={<RetreatNew />} />
        <Route path="/admin/:orgSlug/retreats/:retreatId" element={<RetreatWorkspace />} />
        <Route path="/admin/:orgSlug/retreats/:retreatId/:tab" element={<RetreatWorkspace />} />
        <Route path="/admin/:orgSlug/responses/:responseId" element={<ResponseDetail />} />
        <Route path="/admin/:orgSlug/team" element={<Team />} />
        <Route path="/admin/:orgSlug/audit" element={<Audit />} />
        <Route path="/admin/:orgSlug/interest" element={<Interested />} />
        <Route path="/admin/:orgSlug/privacy" element={<AdminPrivacy />} />
        <Route path="/platform" element={<PlatformConsole />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
