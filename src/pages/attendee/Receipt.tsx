import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router'
import { ApiError, get, post } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { Field } from '../../components/Controls'
import { LinkUnavailable, Loading } from '../../components/States'
import { AlbumLinkCard, type AlbumSummary } from '../../components/AlbumGallery'

interface ReceiptView {
  retreat: { title: string; organiserName: string; organisationName: string; contactEmail: string | null; privacyNoticePath: string }
  status: 'draft' | 'submitted' | 'changes_requested' | 'withdrawn'
  submittedAt: string | null
  storyText: string
  overallRating: number | null
  consents: { publicText: boolean; firstName: boolean; followUp: boolean; marketing: boolean }
  photos: Array<{ id: string; caption: string; publishConsent: boolean; albumConsent: boolean; published: boolean }>
  publication: { status: 'none' | 'published' | 'unpublished' | 'withdrawn'; url: string | null }
  organiserMessage: string | null
  changeRequests: Array<{ kind: 'edit' | 'withdraw'; message: string; status: 'open' | 'resolved'; createdAt: string }>
  album: AlbumSummary | null
}

const PUBLICATION_LABEL: Record<ReceiptView['publication']['status'], string> = {
  none: 'Not published',
  published: 'Published',
  unpublished: 'Not currently published',
  withdrawn: 'Withdrawn at your request',
}

/** The guest's private page. Bookmark-worthy; it never shows anything about anonymous notes. */
export default function Receipt() {
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
    if (!window.confirm(confirmText)) return
    setBusy(true)
    try {
      await post(`${base}/withdraw`, body)
      setNotice({ kind: 'ok', text: 'Done. This takes effect on the public site straight away.' })
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
      <main className="calm">
        <div className="narrow" style={{ padding: '4rem 0' }} role="status">
          <h1>Your information has been deleted</h1>
          <p>
            Your invitation, response, private feedback, photos and permissions have been erased, and anything published has been taken down. This
            link no longer works.
          </p>
          <p className="small muted">Anonymous notes can’t be linked to you, so they are not affected.</p>
        </div>
      </main>
    )
  if (q.isLoading) return <Loading />
  if (q.error) return <LinkUnavailable message={(q.error as Error).message} />
  const d = q.data!
  const c = d.consents

  return (
    <main className="calm">
      <div className="narrow stack" style={{ padding: '3rem 0 5rem' }}>
        <p className="eyebrow">{d.retreat.title}</p>
        <h1>{justSubmitted ? 'Thank you, your response has been sent' : 'Your response'}</h1>
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
            Open your original invitation link to update your response.
          </div>
        )}

        {d.album?.unlocked && <AlbumLinkCard album={d.album} href={`/response/${token}/album`} />}

        <section className="card">
          <div className="spread">
            <h2 style={{ fontSize: '1.3rem', margin: 0 }}>Your story</h2>
            <span className={`badge ${d.publication.status === 'published' ? 'ok' : 'neutral'}`}>{PUBLICATION_LABEL[d.publication.status]}</span>
          </div>
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
            <PermissionRow label="Reuse in social media or advertising" on={c.marketing} busy={busy} onWithdraw={() => withdraw({ scope: 'marketing' }, 'Withdraw marketing permission?')} />
            <PermissionRow label="Contact me about my feedback" on={c.followUp} busy={busy} onWithdraw={() => withdraw({ scope: 'follow_up' }, 'Ask the organiser not to contact you?')} />
            {d.photos.map((p, i) => (
              <PermissionRow
                key={p.id}
                label={`Photo ${i + 1}${p.caption ? `: ${p.caption}` : ''}${p.published ? ' (published)' : ''}`}
                on={p.publishConsent}
                busy={busy}
                onWithdraw={() => withdraw({ scope: 'photo', photoId: p.id }, 'Stop publishing this photo?')}
              />
            ))}
            {d.photos
              .filter((p) => p.albumConsent)
              .map((p) => (
                <PermissionRow
                  key={`album-${p.id}`}
                  label={`${p.caption ? `“${p.caption}”` : 'A photo'} shared in the group album`}
                  on={p.albumConsent}
                  busy={busy}
                  onWithdraw={() => withdraw({ scope: 'album_photo', photoId: p.id }, 'Stop sharing this photo in the group album?')}
                />
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
            Download my data (JSON)
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
      </div>
    </main>
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
