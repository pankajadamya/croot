import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { PLATFORM_OPERATOR } from '../../../shared/legal'
import { get } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { ErrorNotice, Loading } from '../../components/States'

interface NoticeData {
  controller: {
    name: string
    legalName: string | null
    legalAddress: string | null
    privacyEmail: string | null
    contactEmail: string | null
    dpoContact: string | null
    websiteUrl: string | null
    draftRetentionDays: number
    nonResponderRetentionDays: number
    responseRetentionMonths: number
    originalPhotoRetentionDays: number
    anonymousNoteRetentionMonths: number
    updatedAt: string
  }
  programmes: Array<{ slug: string; title: string; kind: 'itinerary' | 'property'; privacyUrl: string | null }>
}

/**
 * Privacy notice for guests (GDPR Arts. 13 and 14), generated from the organisation's own
 * controller details and retention settings so it always matches what the system actually does.
 */
export default function PrivacyNotice() {
  const { orgSlug = '' } = useParams()
  const [params] = useSearchParams()
  const q = useQuery({ queryKey: ['privacy', orgSlug], queryFn: () => get<NoticeData>(`/api/public/orgs/${orgSlug}/privacy`) })
  if (q.isLoading) return <Loading />
  if (q.error)
    return (
      <main className="calm">
        <div className="narrow" style={{ padding: '3rem 0' }}>
          <ErrorNotice error={q.error} />
        </div>
      </main>
    )
  const { controller: c, programmes } = q.data!
  const who = c.legalName || c.name
  const email = c.privacyEmail || c.contactEmail
  const programme = programmes.find((p) => p.slug === params.get('programme'))
  const extra = programme?.privacyUrl ?? programmes.find((p) => p.privacyUrl)?.privacyUrl

  return (
    <main className="calm">
      <article className="narrow legal" style={{ padding: '3rem 0 5rem' }}>
        <p className="eyebrow">Privacy notice{programme ? ` · ${programme.title}` : ''}</p>
        <h1>How {c.name} uses your information when you review your retreat</h1>
        <p className="muted small">Last updated {formatDate(c.updatedAt)}</p>
        {(!c.legalName || !c.legalAddress || !email) && (
          <div className="notice warn" role="note">
            This organiser has not yet completed all of their privacy contact details. Contact them directly if you need more information.
          </div>
        )}

        <h2>Who is responsible for your information</h2>
        <p>
          <strong>{who}</strong>
          {c.legalAddress && <>, {c.legalAddress}</>} is the <em>controller</em> of the information you give in this review. It decides how your
          information is used.
          {email && (
            <>
              {' '}
              Contact them about privacy at <a href={`mailto:${email}`}>{email}</a>.
            </>
          )}
          {c.dpoContact && <> Their data protection officer or representative: {c.dpoContact}.</>}
        </p>
        <p>
          The review site is provided by Croot, which acts as a <em>processor</em>: it stores and handles your information only on {c.name}’s
          instructions. See the <Link to="/legal/privacy">Croot platform privacy notice</Link>.
        </p>

        <h2>What we collect, why, and our legal basis</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Information</th>
                <th scope="col">Why</th>
                <th scope="col">Legal basis (UK/EU GDPR Art. 6)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Your name, email address and, for property stays, your stay dates</td>
                <td>To send you a personal invitation link and keep your answers together</td>
                <td>Legitimate interests: hearing from our guests about their experience</td>
              </tr>
              <tr>
                <td>Private ratings and comments, what to keep and what to change</td>
                <td>To improve future retreats and stays. Only the organiser’s team sees this.</td>
                <td>Legitimate interests. Every question is optional.</td>
              </tr>
              <tr>
                <td>Your public story, first name and photos</td>
                <td>To publish on the review site, only if you switch each item on and the organiser approves it</td>
                <td>Your consent, which you can withdraw at any time</td>
              </tr>
              <tr>
                <td>Permission to contact you about your feedback</td>
                <td>To follow up on something you raised</td>
                <td>Your consent</td>
              </tr>
              <tr>
                <td>Permission for social media or advertising</td>
                <td>To reuse your story or photos outside the review site</td>
                <td>Your consent (separate from website publication)</td>
              </tr>
              <tr>
                <td>Anonymous notes</td>
                <td>To hear concerns you’d rather not attach your name to</td>
                <td>Legitimate interests. Stored without your name, email, link or precise time.</td>
              </tr>
              <tr>
                <td>Records of your permissions and of changes made by the organiser</td>
                <td>To prove what you agreed to, and to keep the service secure</td>
                <td>Legal obligation (accountability) and legitimate interests</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We don’t ask for health or other sensitive information. Please don’t include it in your answers. If you do, it will be treated as private
          feedback and never published. We don’t use your information for automated decisions or profiling, and we don’t sell it.
        </p>

        <h2>Who can see it</h2>
        <ul>
          <li>{c.name}’s organiser team: your invitation details, answers, photos and permissions.</li>
          <li>The public: only the story, first name and photos you agreed to publish, and only after the organiser approves them.</li>
          <li>Croot and its hosting providers, as processors, to run the service securely ({PLATFORM_OPERATOR.hosting}).</li>
        </ul>
        <p>
          If any provider processes data outside the UK or European Economic Area, it does so under appropriate safeguards such as adequacy decisions
          or standard contractual clauses. Ask for details using the contact above.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Unsent drafts: deleted {c.draftRetentionDays} days after you last changed them.</li>
          <li>If you never respond: your name and email are deleted {c.nonResponderRetentionDays} days after the retreat or your stay ends.</li>
          <li>
            Sent responses: private feedback is deleted after {c.responseRetentionMonths} months. A story you agreed to publish stays published until
            you withdraw it; everything else about you is deleted at that point.
          </li>
          <li>Original photo files: deleted {c.originalPhotoRetentionDays} days after you send them. We keep only web copies with location and camera details removed.</li>
          <li>Anonymous notes: deleted after {c.anonymousNoteRetentionMonths} months.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          You can ask to <strong>see</strong>, <strong>correct</strong>, <strong>delete</strong>, <strong>restrict</strong> or{' '}
          <strong>object to</strong> the use of your information, and receive it in a <strong>portable</strong> format. You can{' '}
          <strong>withdraw consent</strong> at any time; this doesn’t affect anything done before you withdrew.
        </p>
        <p>
          The quickest way is your private response page (the link you received after sending your review). There you can download your data, withdraw
          any permission, or delete everything straight away. Otherwise, email {email ? <a href={`mailto:${email}`}>{email}</a> : 'the organiser'}. We
          respond within one month.
        </p>
        <p>
          If you’re unhappy with how your information is handled, you can complain to a data protection authority: in the UK, the Information
          Commissioner’s Office (<a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk</a>), or the
          authority in the EU country where you live or work.
        </p>

        <h2>Cookies</h2>
        <p>
          Invitation links and the public site use no cookies and no analytics or tracking. If you choose to sign in (with an email code or
          Google) to see or change your reviews, one essential session cookie keeps you signed in. If you use Google, we receive only your name,
          verified email address and a Google account identifier. See <Link to="/legal/cookies">cookies</Link>.
        </p>

        {extra && (
          <p className="small">
            The organiser’s own privacy policy also applies:{' '}
            <a href={extra} target="_blank" rel="noopener noreferrer">
              read it here
            </a>
            .
          </p>
        )}
      </article>
    </main>
  )
}
