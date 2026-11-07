import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router'
import { ApiError, get, post } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { Field } from '../../components/Controls'
import { LinkUnavailable, Loading } from '../../components/States'
import { AlbumLinkCard, type AlbumSummary } from '../../components/AlbumGallery'
import { GuestHeader } from '../../components/AppHeader'
import { RetreatPageLink } from '../../components/RetreatPageLink'
import { useConfirm } from '../../components/ConfirmDialog'
import { GuestInterest, ShareJourney, VerifyPrompt } from './ThankYouExtras'

interface ReceiptView {
  retreat: { title: string; organiserName: string; organisationName: string; contactEmail: string | null; privacyNoticePath: string; publicPagePath: string | null }
  status: 'draft' | 'submitted' | 'changes_requested' | 'withdrawn'
  submittedAt: string | null
  storyTitle: string
  storyText: string
  overallRating: number | null
  consents: { publicText: boolean; firstName: boolean; followUp: boolean; marketing: boolean; photoMarketing: boolean | null }
  photos: Array<{ id: string; caption: string; publishConsent: boolean; albumConsent: boolean; published: boolean }>
  publication: { status: 'none' | 'published' | 'unpublished' | 'withdrawn'; url: string | null }
  organiserMessage: string | null
  changeRequests: Array<{ kind: 'edit' | 'withdraw'; message: string; status: 'open' | 'resolved'; createdAt: string }>
  album: AlbumSummary | null
  /** "Make your review count": confirm the email right here (lib/ownVerify.ts on the server). */
  verification?: { verified: boolean; canVerify: boolean; maskedEmail: string | null; needsEmail: boolean }
}

const PUBLICATION_LABEL: Record<ReceiptView['publication']['status'], string> = {
  none: 'Not published',
  published: 'Published',
  unpublished: 'Not currently published',
  withdrawn: 'Withdrawn at your request',
}

/** The guest's private page. Bookmark-worthy; it never shows anything about anonymous notes. */
export default function Receipt() {
  const confirm = useConfirm()
  const { token = '' } = useParams()
  const location = useLocation()
  const justSubmitted = Boolean((location.state as { justSubmitted?: boolean } | null)?.justSubmitted)
  const base = `/api/responses/${token}`
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['receipt', token], queryFn: () => get<ReceiptView>(base), retry: false })
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [requestText, setRequestText] = useState('')
  const [busy, setBusy] = useState(false)
  const [erased, setErased] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  async function withdraw(body: { scope: string; photoId?: string }, confirmText: string) {
    if (!(await confirm({ title: confirmText, confirmLabel: 'Yes, go ahead', danger: true }))) return
    setBusy(true)
    try {
      await post(`${base}/withdraw`, body)
      setNotice({ kind: 'ok', text: doneMessage(body.scope) })
      await qc.invalidateQueries({ queryKey: ['receipt', token] })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  async function requestEdit() {
    setBusy(true)
    try {
      await post(`${base}/change-request`, { kind: 'edit', message: requestText })
      setRequestText('')
      setNotice({ kind: 'ok', text: 'Request sent. The organiser will reopen your response or get in touch.' })
      await qc.invalidateQueries({ queryKey: ['receipt', token] })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  async function eraseEverything() {
    setBusy(true)
    try {
      await post(`${base}/erase`, { confirm: 'DELETE' })
      setErased(true)
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  if (erased)
    return (
      <div className="calm">
        <GuestHeader />
        <main className="narrow" style={{ padding: '4rem 0' }} role="status">
          <h1>Your information has been deleted</h1>
          <p>
            Your invitation, response, private feedback, photos and permissions have been erased, and anything published has been taken down. This
            link no longer works.
          </p>
          <p className="small muted">Anonymous notes can’t be linked to you, so they are not affected.</p>
        </main>
      </div>
    )
  if (q.isLoading) return <Loading />
  if (q.error) return <LinkUnavailable message={(q.error as Error).message} />
  const d = q.data!
  const c = d.consents
  const organiser = d.retreat.organiserName || d.retreat.organisationName

  return (
    <div className="calm">
      <GuestHeader />
      <main className="narrow stack" style={{ padding: '3rem 0 5rem' }}>
        <p className="eyebrow">{d.retreat.title}</p>
        <h1>{justSubmitted ? 'Thank you, your response has been sent' : 'Your response'}</h1>
        {/* Share first, at the top; the same again in the verification pop-up once confirmed. */}
        {d.status !== 'draft' && (
          <ShareJourney compact title={d.retreat.title} organiser={organiser} pagePath={d.retreat.publicPagePath} storyPath={d.publication.url} />
        )}
        {/* Not verified yet: the pop-up (it opens by itself, once per visit). Verified: just a note. */}
        {d.verification?.canVerify && (d.verification.maskedEmail || d.verification.needsEmail) && (
          <VerifyPrompt
            base={base}
            maskedEmail={d.verification.maskedEmail}
            onVerified={() => void qc.invalidateQueries({ queryKey: ['receipt', token] })}
            share={<ShareJourney title={d.retreat.title} organiser={organiser} pagePath={d.retreat.publicPagePath} storyPath={d.publication.url} />}
          />
        )}
        {d.verification?.verified && (
          <p className="verify-done-note small" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">✓</span> Your review shows as <strong>Verified email</strong>.
          </p>
        )}
        {justSubmitted && (
          <p style={{ fontSize: '1.1rem', margin: 0 }}>
            {c.publicText
              ? 'We’ve received your review. It will be published on the retreat page soon, once it has been checked.'
              : 'We’ve received your review. You chose not to publish it, so only the organiser will read it.'}
          </p>
        )}
        {justSubmitted && (
          <div className="notice ok">
            <strong>Bookmark this page.</strong> It’s your private link to see what you sent, change your permissions or ask for an edit. Please don’t share it.
          </div>
        )}
        {notice && (
          <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
          </div>
        )}
        {d.status === 'changes_requested' && d.organiserMessage && (
          <div className="notice warn">
            <strong>The organiser asked:</strong> {d.organiserMessage}
            <br />
            To update it, open your invitation link and sign in when asked, or sign in and open My reviews.
          </div>
        )}

        {d.album?.unlocked && <AlbumLinkCard album={d.album} href={`/response/${token}/album`} />}
        {d.status !== 'draft' && <RetreatPageLink href={d.retreat.publicPagePath} title={d.retreat.title} />}
        {d.status !== 'draft' && <GuestInterest base={base} refresh={d.verification?.verified} />}

        <section className="card">
          <div className="spread">
            <h2 style={{ fontSize: '1.3rem', margin: 0 }}>Your story</h2>
            <span className={`badge ${d.publication.status === 'published' ? 'ok' : 'neutral'}`}>{PUBLICATION_LABEL[d.publication.status]}</span>
          </div>
          {d.storyTitle?.trim() && <h3 style={{ margin: '1rem 0 0' }}>{d.storyTitle.trim()}</h3>}
          {d.storyText ? (
            <p className="serif" style={{ whiteSpace: 'pre-line', marginTop: '1rem' }}>
              {d.storyText}
            </p>
          ) : (
            <p className="muted">You didn’t write a public story. Your private feedback was still sent.</p>
          )}
          {d.publication.url && (
            <p>
              <Link to={d.publication.url}>View it on the review site</Link>
            </p>
          )}
          <p className="small muted">Sent {formatDate(d.submittedAt)}</p>
        </section>

        <section className="card">
          <h2 style={{ fontSize: '1.3rem' }}>Your permissions</h2>
          <p className="small muted">You can withdraw any permission at any time. To give a permission you declined, request an edit below.</p>
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            <PermissionRow
              label="Publish my story"
              on={c.publicText}
              busy={busy}
              onWithdraw={() => withdraw({ scope: 'public_text' }, 'Remove your story from the public site? This happens immediately.')}
            />
            <PermissionRow
              label="Show my first name"
              on={c.firstName}
              busy={busy}
              onWithdraw={() => withdraw({ scope: 'first_name' }, 'Stop showing your first name?')}
            />
            <PermissionRow label="Reuse my story in social media or advertising" on={c.marketing} busy={busy} onWithdraw={() => withdraw({ scope: 'marketing' }, 'Stop reuse of your story in social media and advertising?')} />
            {d.photos.length > 0 && (
              <PermissionRow
                label="Use my photos on their website and social media"
                on={c.photoMarketing === true}
                busy={busy}
                onWithdraw={() => withdraw({ scope: 'photo_marketing' }, 'Stop the organiser using your photos on their website and social media? Any photos shown with your story come off now. They stay in the album.')}
              />
            )}
            <PermissionRow label="Contact me about my feedback" on={c.followUp} busy={busy} onWithdraw={() => withdraw({ scope: 'follow_up' }, 'Ask the organiser not to contact you?')} />
            {d.photos.map((p, i) => (
              <li key={p.id} className="receipt-photo">
                <img src={`${base}/photos/${p.id}/image`} alt={p.caption || `Your photo ${i + 1}`} loading="lazy" />
                <div className="stack" style={{ gap: '0.4rem', flex: 1 }}>
                  <span className="small" style={{ fontWeight: 600 }}>
                    {p.caption || `Photo ${i + 1}`}
                    {p.published ? ' · published' : ''}
                  </span>
                  <PhotoPermission
                    label="With my story"
                    on={p.publishConsent}
                    busy={busy}
                    onWithdraw={() => withdraw({ scope: 'photo', photoId: p.id }, 'Stop publishing this photo with your story?')}
                  />
                  {(p.albumConsent || d.album) && (
                    <PhotoPermission
                      label="In the photo album"
                      on={Boolean(p.albumConsent)}
                      busy={busy}
                      onWithdraw={() => withdraw({ scope: 'album_photo', photoId: p.id }, 'Stop sharing this photo in the photo album?')}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 style={{ fontSize: '1.3rem' }}>Ask for a change</h2>
          <p className="small muted">
            To change your words yourself, <Link to="/signin?next=%2Fmy-reviews">sign in</Link> with the email address your invitation was sent to. Or
            tell the organiser what you’d like changed and they’ll reopen your response.
          </p>
          <Field id="req" label="What would you like to change?">
            <textarea id="req" value={requestText} maxLength={2000} onChange={(e) => setRequestText(e.target.value)} style={{ minHeight: '6rem' }} />
          </Field>
          <button className="btn secondary" onClick={requestEdit} disabled={busy || !requestText.trim()}>
            Send request
          </button>
          {d.changeRequests.length > 0 && (
            <ul className="small muted" style={{ marginTop: '1rem' }}>
              {d.changeRequests.map((r) => (
                <li key={r.createdAt}>
                  {formatDate(r.createdAt)}: {r.kind === 'edit' ? 'Edit request' : 'Withdrawal request'} ({r.status === 'open' ? 'waiting' : 'resolved'})
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="your-data">
          <h2 id="your-data" style={{ fontSize: '1.3rem' }}>
            Your data
          </h2>
          <p className="small muted">
            You have the right to a copy of your information and to have it deleted.{' '}
            <a href={d.retreat.privacyNoticePath} target="_blank" rel="noopener noreferrer">
              Read the privacy notice
            </a>
            .
          </p>
          <a className="btn secondary" href={`${base}/export`} download>
            Download a copy of everything you sent
          </a>
          <details style={{ marginTop: '1.25rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Delete everything</summary>
            <div className="stack" style={{ marginTop: '0.75rem' }}>
              <p>
                This permanently deletes your invitation, story, private feedback, photos and permissions, and takes down anything published. It can’t
                be undone, and this page will stop working.
              </p>
              <Field id="confirm-delete" label="Type DELETE to confirm">
                <input id="confirm-delete" type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
              </Field>
              <button className="btn danger" disabled={busy || confirmText !== 'DELETE'} onClick={eraseEverything}>
                Permanently delete my information
              </button>
            </div>
          </details>
        </section>
        {d.retreat.contactEmail && (
          <p className="small muted">
            Questions? Contact {d.retreat.organiserName || d.retreat.organisationName} at <a href={`mailto:${d.retreat.contactEmail}`}>{d.retreat.contactEmail}</a>.
          </p>
        )}
      </main>
    </div>
  )
}

function doneMessage(scope: string) {
  switch (scope) {
    case 'public_text':
    case 'first_name':
    case 'photo':
      return 'Done. Your public page has been updated.'
    case 'album_photo':
      return 'Done. The photo has been taken out of the album.'
    case 'follow_up':
      return 'Done. The organiser has been asked not to contact you about your feedback.'
    case 'marketing':
      return 'Done. Your story won’t be used in social media or advertising.'
    case 'photo_marketing':
      return 'Done. Your photos won’t be used on their website or social media. They stay in the album.'
    default:
      return 'Done.'
  }
}

function PhotoPermission({ label, on, busy, onWithdraw }: { label: string; on: boolean; busy: boolean; onWithdraw: () => void }) {
  return (
    <span className="row" style={{ gap: '0.5rem' }}>
      <span className="small">{label}</span>
      <span className={`badge ${on ? 'ok' : 'neutral'}`}>{on ? 'Allowed' : 'Not allowed'}</span>
      {on && (
        <button className="btn ghost small" onClick={onWithdraw} disabled={busy}>
          Withdraw
        </button>
      )}
    </span>
  )
}

function PermissionRow({ label, on, busy, onWithdraw }: { label: string; on: boolean; busy: boolean; onWithdraw: () => void }) {
  return (
    <li className="spread" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
      <span>
        {label} <span className={`badge ${on ? 'ok' : 'neutral'}`}>{on ? 'Allowed' : 'Not allowed'}</span>
      </span>
      {on && (
        <button className="btn secondary small" onClick={onWithdraw} disabled={busy}>
          Withdraw
        </button>
      )}
    </li>
  )
}
