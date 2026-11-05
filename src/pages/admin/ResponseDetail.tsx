import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { get, orgApi, post } from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/format'
import { isVerbatimExcerpt } from '../../../shared/excerpt'
import { firstName } from '../../../shared/slug'
import { SCALE_LABELS } from '../../../shared/categories'
import { Stars } from '../../components/Stars'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { AdminShell } from './AdminShell'
import { fieldError, MutationError, orgKey, programmeDates, PublicationBadge, ResponseStatusBadge, YesNo } from './adminUi'
import type { ResponseDetailData } from './types'
import { useConfirm } from '../../components/ConfirmDialog'

const SCOPE_LABELS: Record<string, string> = {
  publicText: 'Publish written story',
  firstName: 'Show first name',
  followUp: 'Contact about feedback',
  marketing: 'Reuse in social media or advertising',
  photo: 'Publish a photo',
}

export default function ResponseDetail() {
  const { orgSlug = '', responseId = '' } = useParams()
  const queryClient = useQueryClient()
  const key = ['admin', orgSlug, 'response', responseId]
  const q = useQuery({ queryKey: key, queryFn: () => get<ResponseDetailData>(`${orgApi(orgSlug)}/responses/${responseId}`) })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: ['admin', orgSlug, 'responses'] })
    void queryClient.invalidateQueries({ queryKey: orgKey(orgSlug) })
  }

  return (
    <AdminShell orgSlug={orgSlug}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNotice error={q.error} />}
      {q.data && <Detail orgSlug={orgSlug} r={q.data} refresh={refresh} />}
    </AdminShell>
  )
}

function Section({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id} style={{ marginTop: 0 }}>
        {title}
      </h2>
      {note && <p className="small muted">{note}</p>}
      {children}
    </section>
  )
}

function Detail({ orgSlug, r, refresh }: { orgSlug: string; r: ResponseDetailData; refresh: () => void }) {
  const story = r.publicStory
  const hasStory = story.text.trim().length > 0
  const liveUrl = r.publication.status === 'published' && r.publication.publicSlug ? `/stories/${r.publication.publicSlug}` : null

  return (
    <>
      <p className="small">
        <Link to={`/admin/${orgSlug}/retreats/${r.retreat.id}/responses`}>← {r.retreat.title}: responses</Link>
      </p>
      <div className="spread" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>{r.attendee.name}</h1>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            Submitted {formatDateTime(r.submittedAt)}
            {r.attendee.stay && (
              <>
                {' · '}
                {r.attendee.stay.start || r.attendee.stay.end
                  ? `Stayed ${programmeDates(r.attendee.stay.start, r.attendee.stay.end)}`
                  : 'Stay dates not given'}
              </>
            )}
          </p>
        </div>
        <div className="row">
          <ResponseStatusBadge status={r.status} />
          <PublicationBadge status={r.publication.status} />
          {liveUrl && (
            <a className="btn secondary small" href={liveUrl} target="_blank" rel="noreferrer">
              View live story
            </a>
          )}
        </div>
      </div>

      <div className="stack">
        <Section id="sec-story" title="Public story" note="The guest’s own words. Organisers can’t edit them — use “Request changes” to ask the guest to revise.">
          {hasStory ? (
            <>
              {story.title?.trim() && <h3 style={{ margin: '0 0 0.5rem' }}>{story.title.trim()}</h3>}
              <blockquote className="guest-quote">{story.text}</blockquote>
              {story.submittedText !== null && story.submittedText !== story.text && (
                <details>
                  <summary>Originally submitted text (differs from the current version)</summary>
                  <blockquote className="guest-quote muted">{story.submittedText}</blockquote>
                </details>
              )}
            </>
          ) : (
            <p className="muted">No public story — this guest sent private feedback only.</p>
          )}
          <p>
            <strong>Overall rating:</strong>{' '}
            {story.overallRating ? (
              <span className="rating-cell">
                <Stars value={story.overallRating} />
                <span className="muted small">{SCALE_LABELS[story.overallRating]}</span>
              </span>
            ) : (
              'Not given'
            )}
          </p>
        </Section>

        <Section id="sec-private" title="Private feedback" note="Never published. Visible only to your team.">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Comment</th>
                </tr>
              </thead>
              <tbody>
                {r.privateFeedback.ratings.map((x) => (
                  <tr key={x.key}>
                    <td>{x.label}</td>
                    <td>
                      {x.notApplicable ? (
                        <span className="badge neutral">Not applicable</span>
                      ) : x.score ? (
                        <span className="rating-cell">
                          <Stars value={x.score} />
                          <span className="muted small">{SCALE_LABELS[x.score]}</span>
                        </span>
                      ) : (
                        <span className="muted">Not answered</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{x.comment || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid-2" style={{ marginTop: '1rem' }}>
            <div>
              <h3>What to keep</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.privateFeedback.keepText || <span className="muted">Not answered</span>}</p>
            </div>
            <div>
              <h3>What to change</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.privateFeedback.changeText || <span className="muted">Not answered</span>}</p>
            </div>
          </div>
          <p>
            <strong>Happy to be contacted:</strong> <YesNo value={r.privateFeedback.followUpOk} />
            {r.privateFeedback.followUpOk && r.attendee.email && (
              <>
                {' '}
                <a href={`mailto:${r.attendee.email}`}>{r.attendee.email}</a>
              </>
            )}
          </p>
          {!r.privateFeedback.followUpOk && <p className="small muted">The guest’s email is hidden because they did not agree to be contacted.</p>}
        </Section>

        <PhotosSection orgSlug={orgSlug} r={r} refresh={refresh} />

        <Section id="sec-consent" title="Consent" note="The guest’s current choices.">
          <ul className="consent-list">
            <li>
              Publish written story <YesNo value={r.consents.publicText} />
            </li>
            <li>
              Show first name <YesNo value={r.consents.firstName} />
            </li>
            <li>
              Contact about feedback <YesNo value={r.consents.followUp} />
            </li>
            <li>
              Reuse in social media or advertising <YesNo value={r.consents.marketing} />
            </li>
          </ul>
          {r.consents.history.length > 0 && (
            <details>
              <summary>Consent history ({r.consents.history.length})</summary>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Choice</th>
                      <th scope="col">Answer</th>
                      <th scope="col">By</th>
                      <th scope="col">Wording</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.consents.history.map((h, i) => (
                      <tr key={i}>
                        <td>{formatDateTime(h.at)}</td>
                        <td>{SCOPE_LABELS[h.scope] ?? h.scope}</td>
                        <td>{h.granted ? 'Granted' : 'Declined or withdrawn'}</td>
                        <td>{h.actor === 'attendee' ? 'Guest' : h.actor === 'organiser' ? 'Organiser' : 'System'}</td>
                        <td>{h.wordingVersion ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Section>

        <PublicationSection key={r.publication.live?.at ?? 'none'} orgSlug={orgSlug} r={r} refresh={refresh} />
        <RequestChanges orgSlug={orgSlug} r={r} refresh={refresh} />
        <ChangeRequests orgSlug={orgSlug} r={r} refresh={refresh} />
      </div>
    </>
  )
}

function PhotosSection({ orgSlug, r, refresh }: { orgSlug: string; r: ResponseDetailData; refresh: () => void }) {
  const moderate = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected' }) => post(`${orgApi(orgSlug)}/media/${v.id}/moderate`, { status: v.status }),
    onSuccess: refresh,
  })
  return (
    <Section id="sec-photos" title="Photos" note="Each photo needs the guest’s own permission and your approval before it can appear with their story.">
      {r.photos.length === 0 && <p className="muted">No photos.</p>}
      <MutationError error={moderate.error} />
      {r.photos.some((p) => (p.publishConsent || p.albumConsent) && p.moderation !== 'approved') && (
        <button
          type="button"
          className="btn secondary small"
          disabled={moderate.isPending}
          onClick={() => {
            const ids = r.photos.filter((p) => (p.publishConsent || p.albumConsent) && p.moderation !== 'approved').map((p) => p.id)
            void Promise.all(ids.map((id) => moderate.mutateAsync({ id, status: 'approved' }))).catch(() => {})
          }}
        >
          Approve all photos the guest allowed
        </button>
      )}
      <p className="small muted" style={{ margin: '0.5rem 0' }}>
        Rejecting a photo hides it; you can approve it again later.
      </p>
      {r.photos.length > 0 && (
        <ul className="media-grid" style={{ listStyle: 'none', padding: 0 }}>
          {r.photos.map((p) => (
            <li key={p.id} className="card tight">
              <img src={p.previewUrl} alt={p.altText || 'Guest photo'} loading="lazy" />
              {p.caption && <p className="small">{p.caption}</p>}
              <div className="row small" style={{ margin: '0.5rem 0' }}>
                <span className={`badge ${p.publishConsent ? 'ok' : 'danger'}`}>{p.publishConsent ? 'Guest allows publishing' : 'Guest declined publishing'}</span>
                <span className={`badge ${p.moderation === 'approved' ? 'ok' : p.moderation === 'rejected' ? 'danger' : 'neutral'}`}>
                  {p.moderation === 'approved' ? 'Approved' : p.moderation === 'rejected' ? 'Rejected' : 'Awaiting review'}
                </span>
                {p.live && <span className="badge ok">Live</span>}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn small"
                  disabled={!p.publishConsent || p.moderation === 'approved' || moderate.isPending}
                  aria-describedby={!p.publishConsent ? `no-consent-${p.id}` : undefined}
                  onClick={() => moderate.mutate({ id: p.id, status: 'approved' })}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={p.moderation === 'rejected' || moderate.isPending}
                  onClick={() => moderate.mutate({ id: p.id, status: 'rejected' })}
                >
                  Reject
                </button>
              </div>
              {!p.publishConsent && (
                <p className="small muted" id={`no-consent-${p.id}`}>
                  Can’t be approved: the guest chose not to publish this photo. It stays private to your team.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function PublicationSection({ orgSlug, r, refresh }: { orgSlug: string; r: ResponseDetailData; refresh: () => void }) {
  const confirm = useConfirm()
  const live = r.publication.live
  const [excerpt, setExcerpt] = useState(live?.excerpt ?? r.publicStory.suggestedExcerpt)
  const eligiblePhotos = r.photos.filter((p) => p.publishConsent && p.moderation === 'approved')
  const [photoIds, setPhotoIds] = useState<string[]>(() => (live ? live.photoIds : eligiblePhotos.map((p) => p.id)).filter((id) => eligiblePhotos.some((p) => p.id === id)))
  // A photo approved after this form opened is ticked straight away (and one no longer eligible unticked),
  // so approving and then publishing includes it.
  const eligibleKey = eligiblePhotos.map((p) => p.id).join(',')
  const seenEligible = useRef(new Set(eligiblePhotos.map((p) => p.id)))
  useEffect(() => {
    const ids = eligiblePhotos.map((p) => p.id)
    const fresh = ids.filter((id) => !seenEligible.current.has(id))
    ids.forEach((id) => seenEligible.current.add(id))
    setPhotoIds((cur) => [...cur.filter((id) => ids.includes(id)), ...fresh.filter((id) => !cur.includes(id))])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey])
  const [reason, setReason] = useState('')
  const [unpublishReason, setUnpublishReason] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: () => post<{ publicSlug: string; url: string }>(`${orgApi(orgSlug)}/responses/${r.id}/publish`, { excerpt, photoIds, reason: reason.trim() || undefined }),
    onSuccess: async (res) => {
      setDone(`Published at ${res.url}.`)
      refresh()
      // Offer the next story waiting, so publishing several isn't a round trip each time.
      const next = await get<{ responses: Array<{ id: string }> }>(`${orgApi(orgSlug)}/retreats/${r.retreat.id}/responses?queue=ready&status=all&publication=all`).catch(() => null)
      setNextId(next?.responses.find((x) => x.id !== r.id)?.id ?? null)
    },
  })
  const [nextId, setNextId] = useState<string | null>(null)
  const unpublish = useMutation({
    mutationFn: () => post(`${orgApi(orgSlug)}/responses/${r.id}/unpublish`, { reason: unpublishReason }),
    onSuccess: () => {
      setDone('Unpublished. The story page now shows as unavailable.')
      refresh()
    },
  })
  const pin = useMutation({
    mutationFn: (pinned: boolean) => post(`${orgApi(orgSlug)}/responses/${r.id}/pin`, { pinned }),
    onSuccess: refresh,
  })

  const blockers: string[] = []
  if (r.status !== 'submitted')
    blockers.push(
      r.status === 'withdrawn'
        ? 'The guest withdrew this response.'
        : live
          ? 'The guest is revising it. The version already live stays up until they send it again and you publish the update.'
          : 'The guest is revising their response.',
    )
  if (!r.publicStory.text.trim()) blockers.push('There is no public story.')
  if (!r.consents.publicText) blockers.push('The guest has not consented to publishing their story.')
  const excerptOk = isVerbatimExcerpt(r.publicStory.text, excerpt)
  const isLive = r.publication.status === 'published'
  const name = r.consents.firstName ? firstName(r.attendee.name) : null

  return (
    <Section id="sec-publication" title="Publication">
      <p>
        Status: <PublicationBadge status={r.publication.status} />
        {live && <span className="small muted"> since {formatDateTime(live.at)}</span>}
      </p>
      {isLive && r.publication.publicSlug && (
        <p>
          Live story:{' '}
          <a href={`/stories/${r.publication.publicSlug}`} target="_blank" rel="noreferrer">
            /stories/{r.publication.publicSlug}
          </a>
        </p>
      )}
      {blockers.length > 0 ? (
        <div className="notice warn" role="status">
          This story can’t be published:
          <ul style={{ margin: '0.25rem 0 0' }}>
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <Field
            id="pub-excerpt"
            label="Showcase excerpt"
            hint="The quote shown in the story slideshow. Use the guest’s exact words: you can shorten it, but not reword it."
            error={fieldError(publish.error, 'excerpt')}
          >
            <textarea id="pub-excerpt" style={{ minHeight: '6rem' }} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} aria-describedby="pub-excerpt-hint" />
          </Field>
          <div className="row small" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
            <span className={`badge ${excerptOk ? 'ok' : 'danger'}`}>{excerptOk ? 'Matches the guest’s words' : 'Not found word for word in the story'}</span>
            <button type="button" className="btn ghost small" onClick={() => setExcerpt(r.publicStory.suggestedExcerpt)}>
              Use suggested excerpt
            </button>
          </div>
          <p className="small">
            <strong>Shown as:</strong> {name ?? 'No name (the guest did not consent to showing their first name)'}
          </p>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
            <legend style={{ fontWeight: 600 }}>Photos to include</legend>
            {eligiblePhotos.length === 0 ? (
              <p className="small muted">No photos are both allowed by the guest and approved.</p>
            ) : (
              <div className="row">
                {eligiblePhotos.map((p, i) => (
                  <label key={p.id} className="photo-pick">
                    <input
                      type="checkbox"
                      checked={photoIds.includes(p.id)}
                      onChange={(e) => setPhotoIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                    />
                    <img src={p.previewUrl} alt="" />
                    <span className="small">{p.caption || p.altText || `Photo ${i + 1}`}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <Field id="pub-reason" label="Note for the audit log (optional)">
            <input id="pub-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <MutationError error={publish.error} shownFields={['excerpt']} />
          <button type="button" className="btn" disabled={!excerptOk || publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? 'Publishing…' : isLive ? 'Republish with these choices' : 'Publish story'}
          </button>
        </>
      )}

      {nextId && (
        <p className="notice ok small" role="status">
          <Link to={`/admin/${orgSlug}/responses/${nextId}`}>Next story ready to publish →</Link>
        </p>
      )}
      {done && (
        <div className="notice ok" role="status" style={{ marginTop: '1rem' }}>
          {done}
        </div>
      )}

      {isLive && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn secondary small" disabled={pin.isPending} onClick={() => pin.mutate(!r.publication.pinned)}>
              {r.publication.pinned ? 'Unpin from the top of the showcase' : 'Pin to the top of the showcase'}
            </button>
            {r.publication.pinned && <span className="badge ok">Pinned</span>}
          </div>
          <MutationError error={pin.error} />
          <h3>Unpublish</h3>
          <Field id="unpub-reason" label="Reason (required, kept in the audit log)" error={fieldError(unpublish.error, 'reason')}>
            <input id="unpub-reason" type="text" maxLength={500} value={unpublishReason} onChange={(e) => setUnpublishReason(e.target.value)} />
          </Field>
          <MutationError error={unpublish.error} shownFields={['reason']} />
          <button
            type="button"
            className="btn danger"
            disabled={!unpublishReason.trim() || unpublish.isPending}
            onClick={() =>
              void confirm({ title: 'Take this story off your public page now?', message: 'It disappears from your public page straight away.', confirmLabel: 'Unpublish', danger: true }).then(
                (ok) => ok && unpublish.mutate(),
              )
            }
          >
            {unpublish.isPending ? 'Unpublishing…' : 'Unpublish now'}
          </button>
        </div>
      )}

      {r.publication.history.length > 0 && (
        <details style={{ marginTop: '1.5rem' }}>
          <summary>Publication history ({r.publication.history.length})</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Event</th>
                  <th scope="col">Excerpt</th>
                  <th scope="col">Photos</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {r.publication.history.map((h, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(h.at)}</td>
                    <td>{h.status}</td>
                    <td className="small">{h.excerpt}</td>
                    <td>{h.photoCount}</td>
                    <td className="small">{h.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  )
}

function RequestChanges({ orgSlug, r, refresh }: { orgSlug: string; r: ResponseDetailData; refresh: () => void }) {
  const [message, setMessage] = useState('')
  const send = useMutation({
    mutationFn: () => post(`${orgApi(orgSlug)}/responses/${r.id}/request-changes`, { message }),
    onSuccess: () => {
      setMessage('')
      refresh()
    },
  })
  return (
    <Section
      id="sec-request"
      title="Request changes"
      note="Explain what you’d like the guest to look at. Their link becomes editable again and they resubmit in their own words. Nothing changes until they do."
    >
      {r.status === 'changes_requested' ? (
        <div className="notice warn" role="status">
          Waiting for the guest. Your message: “{r.organiserMessage}”
        </div>
      ) : r.status !== 'submitted' ? (
        <p className="muted">Not available for a withdrawn response.</p>
      ) : (
        <>
          <Field id="rc-message" label="Message to the guest" error={fieldError(send.error, 'message')}>
            <textarea id="rc-message" maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <p className="small muted">The guest sees this the next time they open their link. Make sure they still have it, or reissue one from the Invitations tab.</p>
          <MutationError error={send.error} shownFields={['message']} />
          <button type="button" className="btn secondary" disabled={!message.trim() || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? 'Sending…' : 'Return to guest with this message'}
          </button>
        </>
      )}
    </Section>
  )
}

function ChangeRequests({ orgSlug, r, refresh }: { orgSlug: string; r: ResponseDetailData; refresh: () => void }) {
  const resolve = useMutation({ mutationFn: (id: string) => post(`${orgApi(orgSlug)}/change-requests/${id}/resolve`), onSuccess: refresh })
  return (
    <Section id="sec-requests" title="Requests from the guest">
      {r.changeRequests.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {r.changeRequests.map((c) => (
            <li key={c.id} className="card tight">
              <div className="spread">
                <span>
                  <strong>{c.kind === 'withdraw' ? 'Withdrawal request' : 'Edit request'}</strong> <span className="small muted">· {formatDate(c.createdAt)}</span>
                </span>
                {c.status === 'open' ? (
                  <button type="button" className="btn secondary small" disabled={resolve.isPending} onClick={() => resolve.mutate(c.id)}>
                    Mark as resolved
                  </button>
                ) : (
                  <span className="badge ok">Resolved</span>
                )}
              </div>
              <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{c.message}</p>
            </li>
          ))}
        </ul>
      )}
      <MutationError error={resolve.error} />
    </Section>
  )
}
