import type { ReactNode } from 'react'
import { GuestHeader } from '../../components/AppHeader'
import { Link, Navigate, useParams } from 'react-router'
import { LEGAL_LAST_UPDATED, PLATFORM_OPERATOR, PLATFORM_PRIVACY_VERSION, PROCESSING_TERMS_VERSION } from '../../../shared/legal'

/** Platform-level legal texts, written to match how Croot actually processes data. */
function Shell({ title, version, children }: { title: string; version: string; children: ReactNode }) {
  return (
    <main className="calm">
      <GuestHeader />
      <article className="narrow legal" style={{ padding: '3rem 0 5rem' }}>
        <p className="eyebrow">
          <Link to="/">Croot</Link> · Legal
        </p>
        <h1>{title}</h1>
        <p className="muted small">
          Last updated {LEGAL_LAST_UPDATED} · version {version}
        </p>
        {children}
        <p className="small muted" style={{ marginTop: '2.5rem' }}>
          Croot is operated by {PLATFORM_OPERATOR.name}, {PLATFORM_OPERATOR.address}. Contact:{' '}
          <a href={`mailto:${PLATFORM_OPERATOR.email}`}>{PLATFORM_OPERATOR.email}</a>.
        </p>
        <nav className="row small" aria-label="Legal pages" style={{ marginTop: '3rem' }}>
          <Link to="/legal/privacy">Platform privacy notice</Link>
          <Link to="/legal/terms">Data processing terms</Link>
          <Link to="/legal/cookies">Cookies</Link>
        </nav>
      </article>
    </main>
  )
}

function PlatformPrivacy() {
  return (
    <Shell title="Croot platform privacy notice" version={PLATFORM_PRIVACY_VERSION}>
      <h2>Two roles</h2>
      <p>
        <strong>Guests:</strong> each retreat organiser or property owner using Croot is the <em>controller</em> of their guests’ information, and
        Croot is their <em>processor</em>. Each organiser’s own privacy notice, linked from every invitation, explains how they use your
        information. Send requests about guest data to the organiser. If you contact us instead, we will pass your request to them without delay.
      </p>
      <p>
        <strong>Organisers and people requesting access:</strong> {PLATFORM_OPERATOR.name}, {PLATFORM_OPERATOR.address}, is the controller of the
        information about you described below. Contact: <a href={`mailto:${PLATFORM_OPERATOR.email}`}>{PLATFORM_OPERATOR.email}</a>.
      </p>
      <h2>What we collect about organisers</h2>
      <ul>
        <li>
          Organiser requests and invitations (name, email, phone, organisation, website, country, the kind and scale of your retreats, and any
          note): to decide on and set up organiser access. Legal basis: steps before a contract.
        </li>
        <li>Account details (name, email, password hash, role, last sign-in): to provide the service. Legal basis: contract.</li>
        <li>
          Sign-in: one-time codes sent to your email (stored only as a keyed hash, deleted within a day), and, if you choose Google, your Google
          account identifier, name and verified email. Legal basis: contract, or for guests the organiser’s legitimate interests.
        </li>
        <li>Security and audit records of actions taken in the workspace: legitimate interests and accountability.</li>
      </ul>
      <h2>Retention</h2>
      <ul>
        <li>Declined access requests: 6 months. Approved requests: 24 months.</li>
        <li>Accounts: while the organisation uses Croot. Deleted with the organisation unless you belong to another.</li>
        <li>Sessions expire after inactivity and are deleted automatically. Audit records follow each organisation’s retention setting.</li>
      </ul>
      <h2>Sub-processors and transfers</h2>
      <p>
        Hosting: {PLATFORM_OPERATOR.hosting}. Email delivery: {PLATFORM_OPERATOR.email_delivery}. Optional sign-in: {PLATFORM_OPERATOR.sign_in}. Page statistics
        run on our own servers (see <Link to="/legal/cookies">cookies</Link>). We do not use advertising or tracking services. Any change is
        announced to organisers in advance.
      </p>
      <p>
        Your information is stored in the UK and the European Economic Area. Amazon Web Services and Google are part of groups based in the
        United States; where information may reach them there, the transfer relies on the UK Extension to the EU–US Data Privacy Framework or on the
        UK International Data Transfer Addendum to standard contractual clauses.
      </p>
      <h2>Your rights and complaints</h2>
      <p>
        You can access, correct, delete, restrict, object to or port your information by emailing us. You may also complain to the UK Information
        Commissioner’s Office or your local EU data protection authority.
      </p>
    </Shell>
  )
}

function ProcessingTerms() {
  return (
    <Shell title="Data processing terms (summary)" version={PROCESSING_TERMS_VERSION}>
      <p>
        These terms apply between each organisation using Croot (the controller) and {PLATFORM_OPERATOR.name} (the processor), as required by
        Article 28 of the UK GDPR and EU GDPR. The full agreement will be supplied for signature before launch. In summary, Croot:
      </p>
      <ol>
        <li>Processes guest data only on the organisation’s documented instructions, given through the product’s settings and actions.</li>
        <li>Ensures everyone with access is bound by confidentiality. Platform staff access to an organisation’s workspace is logged in its audit log.</li>
        <li>
          Applies appropriate security: encrypted transport, hashed access links and passwords, per-request access checks, metadata stripped from photos,
          separation between public and private data, and audit records.
        </li>
        <li>Uses only the sub-processors listed in the platform privacy notice, and gives notice before adding or replacing one.</li>
        <li>Helps the organisation answer guests’ rights requests, with built-in export, withdrawal and erasure tools.</li>
        <li>Notifies the organisation without undue delay, and within 48 hours where possible, after becoming aware of a personal data breach.</li>
        <li>Deletes or returns all data at the end of the service. The organisation can export everything at any time, and deletion is permanent.</li>
        <li>Provides the information needed to demonstrate compliance, and allows for audits.</li>
      </ol>
      <p>The organisation is responsible for its privacy notice details, retention choices, the lawful basis for inviting its guests, and approving content before publication.</p>
    </Shell>
  )
}

function Cookies() {
  return (
    <Shell title="Cookies" version={PLATFORM_PRIVACY_VERSION}>
      <p>Croot sets cookies only when someone signs in (organisers, or guests who choose to sign in instead of using their link):</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Purpose</th>
              <th scope="col">Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>__Host-croot_session</td>
              <td>Keeps you signed in (strictly necessary)</td>
              <td>Up to 12 hours of inactivity</td>
            </tr>
            <tr>
              <td>croot_oauth</td>
              <td>Protects a Google sign-in from forgery while it is in progress (strictly necessary)</td>
              <td>10 minutes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Croot uses no advertising or tracking, and sets no cookies on invitation links or public pages, so no cookie consent banner is
        needed. Strictly necessary cookies are exempt from consent under PECR and the ePrivacy Directive.
      </p>
      <h2>Page statistics</h2>
      <p>
        Croot counts visits anonymously, to see which pages are read, how guests find their way to a review and where they give up. It uses
        Umami, which runs on our own servers (not a third party). It sets no cookies, stores nothing on your device, does not store your IP
        address, cannot follow you between visits or sites, and nothing links a visit to you or to your review.
      </p>
      <p>
        It records the page (public pages by their address; invitation, receipt, album and organiser pages only by their kind, never a link’s
        code or an id), the site you came from, how a link was shared when it says so (for example “email” in an invitation link), and your
        browser, operating system, device type, screen size, language and country. My reviews is not counted. If your browser sends “Do Not
        Track”, nothing is counted.
      </p>
      <p>
        The first time you heart a photo or mark a review as helpful, your browser keeps a random visitor ID in its local storage
        (<code>croot.visitor</code>) so you can do each once and take it back. Just viewing a page stores nothing. It isn’t a cookie, isn’t
        linked to you, and is used for nothing else; we store only a scrambled form of it with each vote. Clearing your browser’s site data
        removes it.
      </p>
      <p>
        While you write an anonymous note in a review form, its draft is kept in this tab’s session storage so a reload doesn’t lose it. It is
        cleared when the note is sent or the tab is closed, and never leaves your browser until you send it.
      </p>
    </Shell>
  )
}

export default function Legal() {
  const { doc } = useParams()
  if (doc === 'privacy') return <PlatformPrivacy />
  if (doc === 'terms') return <ProcessingTerms />
  if (doc === 'cookies') return <Cookies />
  return <Navigate to="/legal/privacy" replace />
}
