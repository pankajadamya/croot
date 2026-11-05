import type { ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { PLATFORM_OPERATOR, PLATFORM_PRIVACY_VERSION, PROCESSING_TERMS_VERSION } from '../../../shared/legal'

/**
 * Platform-level legal texts. These are working DRAFTS written to match how croot actually
 * processes data; a qualified privacy professional must review them before launch.
 */
function Shell({ title, version, children }: { title: string; version: string; children: ReactNode }) {
  return (
    <main className="calm">
      <article className="narrow legal" style={{ padding: '3rem 0 5rem' }}>
        <p className="eyebrow">
          <Link to="/">croot</Link> · Legal
        </p>
        <h1>{title}</h1>
        <p className="muted small">Version {version}</p>
        <div className="notice warn" role="note">
          Draft for legal review. This text reflects how the service works, but it has not yet been approved for publication.
        </div>
        {children}
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
    <Shell title="croot platform privacy notice" version={PLATFORM_PRIVACY_VERSION}>
      <h2>Two roles</h2>
      <p>
        <strong>Guests:</strong> each retreat organiser or property owner using croot is the <em>controller</em> of their guests’ information, and
        croot is their <em>processor</em>. Each organiser’s own privacy notice, linked from every invitation, explains how they use your
        information. Send requests about guest data to the organiser. If you contact us instead, we will pass your request to them without delay.
      </p>
      <p>
        <strong>Organisers and people requesting access:</strong> {PLATFORM_OPERATOR.name}, {PLATFORM_OPERATOR.address}, is the controller of the
        information about you described below. Contact: <a href={`mailto:${PLATFORM_OPERATOR.email}`}>{PLATFORM_OPERATOR.email}</a>.
      </p>
      <h2>What we collect about organisers</h2>
      <ul>
        <li>Access requests (name, email, organisation, website, message): to assess and set up your account. Legal basis: steps before a contract.</li>
        <li>Account details (name, email, password hash, role, last sign-in): to provide the service. Legal basis: contract.</li>
        <li>Security and audit records of actions taken in the workspace: legitimate interests and accountability.</li>
      </ul>
      <h2>Retention</h2>
      <ul>
        <li>Declined access requests: 6 months. Approved requests: 24 months.</li>
        <li>Accounts: while the organisation uses croot. Deleted with the organisation unless you belong to another.</li>
        <li>Sessions expire after inactivity and are deleted automatically. Audit records follow each organisation’s retention setting.</li>
      </ul>
      <h2>Sub-processors and transfers</h2>
      <p>Hosting: {PLATFORM_OPERATOR.hosting}. We do not use advertising, analytics or tracking services. Any change is announced to organisers in advance.</p>
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
        These terms apply between each organisation using croot (the controller) and {PLATFORM_OPERATOR.name} (the processor), as required by
        Article 28 of the UK GDPR and EU GDPR. The full agreement will be supplied for signature before launch. In summary, croot:
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
      <p>croot sets one cookie, and only when an organiser signs in:</p>
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
              <td>croot_session</td>
              <td>Keeps an organiser signed in (strictly necessary)</td>
              <td>Up to 12 hours of inactivity</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Guests, invitation links, anonymous notes and public story pages set no cookies and use no analytics, advertising or tracking, so no cookie
        consent banner is needed. Strictly necessary cookies are exempt from consent under PECR and the ePrivacy Directive. If analytics are ever
        added, they will stay off guest pages and require consent first.
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
