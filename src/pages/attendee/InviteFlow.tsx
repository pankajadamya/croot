import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CONSENT_WORDING, storyPromptsFor, type FeedbackCategory, type ReviewKind } from '../../../shared/categories'
import { api, ApiError, del, get, patch, post, put } from '../../lib/api'
import { formatRange } from '../../lib/format'
import { Field, RatingScale, Switch } from '../../components/Controls'
import { LinkUnavailable, Loading } from '../../components/States'
import { PhotoPanel } from './PhotoPanel'

interface Rating {
  categoryKey: string
  score: number | null
  notApplicable: boolean
  comment: string
}
interface Photo {
  id: string
  altText: string
  caption: string
  publishConsent: boolean
  width: number
  height: number
}
interface Consents {
  publicText: boolean
  firstName: boolean
  followUp: boolean
  marketing: boolean
}
interface InviteView {
  firstName: string
  editable: boolean
  signIn: { required: boolean; signedIn: boolean; canReopen: boolean }
  retreat: {
    kind: ReviewKind
    title: string
    startDate: string | null
    endDate: string | null
    organiserName: string
    organisationName: string
    categories: FeedbackCategory[]
    privacyUrl: string | null
    anonymousPath: string
    privacyNoticePath: string
    slideshow: Array<{ url: string; alt: string; caption: string }>
    opening: { headline: string; introParagraphs: string[] } | null
  }
  response: {
    status: 'draft' | 'submitted' | 'changes_requested' | 'withdrawn'
    revision: number
    currentStep: number
    storyText: string
    overallRating: number | null
    keepText: string
    changeText: string
    consents: Consents
    ratings: Rating[]
    photos: Photo[]
    submittedAt: string | null
    organiserMessage: string | null
  } | null
}

interface Draft {
  storyText: string
  overallRating: number | null
  keepText: string
  changeText: string
  consents: Consents
  ratings: Record<string, Rating>
}

const STEPS = ['Welcome', 'Your story', 'Private feedback', 'Anonymous note', 'Photos & permissions', 'Review & send'] as const
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

function emptyDraft(view: InviteView): Draft {
  const r = view.response
  const ratings: Record<string, Rating> = {}
  for (const c of view.retreat.categories) {
    const existing = r?.ratings.find((x) => x.categoryKey === c.key)
    ratings[c.key] = existing ?? { categoryKey: c.key, score: null, notApplicable: false, comment: '' }
  }
  return {
    storyText: r?.storyText ?? '',
    overallRating: r?.overallRating ?? null,
    keepText: r?.keepText ?? '',
    changeText: r?.changeText ?? '',
    consents: r?.consents ?? { publicText: false, firstName: false, followUp: false, marketing: false },
    ratings,
  }
}

/** Reached by the guest's unique link. */
export default function InviteFlow() {
  const { token = '' } = useParams()
  return <ReviewFlow base={`/api/invites/${token}`} />
}

/**
 * The review form, by unique link (base /api/invites/:token) or signed in (base /api/me/reviews/:id).
 * Drafts can be resumed either way; changing a review that was already sent needs a verified sign-in.
 */
export function ReviewFlow({ base, viaSignIn = false }: { base: string; viaSignIn?: boolean }) {
  const navigate = useNavigate()
  const [reopening, setReopening] = useState(false)
  const [view, setView] = useState<InviteView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [step, setStep] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const revision = useRef(0)
  const dirty = useRef(false)
  const saving = useRef<Promise<void> | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const load = useCallback(async () => {
    try {
      const v = await get<InviteView>(base)
      setView(v)
      setDraft(emptyDraft(v))
      setPhotos(v.response?.photos ?? [])
      revision.current = v.response?.revision ?? 0
      setStep(v.response ? Math.min(v.response.currentStep, STEPS.length - 1) : 0)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'This link could not be opened.')
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  // ---- saving ---------------------------------------------------------------------------------

  const save = useCallback(
    async (nextStep?: number) => {
      if (!draft || !view?.editable) return
      if (saving.current) await saving.current.catch(() => {})
      const body = {
        revision: revision.current,
        currentStep: nextStep ?? step,
        storyText: draft.storyText,
        overallRating: draft.overallRating,
        keepText: draft.keepText,
        changeText: draft.changeText,
        consents: draft.consents,
        ratings: Object.values(draft.ratings),
      }
      dirty.current = false
      setSaveState('saving')
      const p = put<{ revision: number; savedAt: string }>(`${base}/draft`, body)
        .then((r) => {
          revision.current = r.revision
          setSavedAt(new Date(r.savedAt))
          setSaveState(dirty.current ? 'idle' : 'saved')
        })
        .catch((e: unknown) => {
          dirty.current = true
          setSaveState(e instanceof ApiError && e.details?.conflict ? 'conflict' : 'error')
          throw e
        })
        .finally(() => {
          saving.current = null
        })
      saving.current = p
      return p
    },
    [base, draft, step, view?.editable],
  )

  // Debounced autosave while typing.
  useEffect(() => {
    if (!dirty.current || !view?.editable) return
    const id = window.setTimeout(() => void save().catch(() => {}), 1500)
    return () => window.clearTimeout(id)
  }, [draft, save, view?.editable])

  // Warn before leaving with unsaved text.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function update(patchDraft: Partial<Draft>) {
    dirty.current = true
    setSaveState('idle')
    setDraft((d) => (d ? { ...d, ...patchDraft } : d))
  }

  async function goTo(next: number) {
    // Save after each step; moving on never depends on a successful save (text stays on the page).
    try {
      await save(next)
    } catch {
      /* state shows the error and a retry */
    }
    setStep(next)
    window.scrollTo({ top: 0 })
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await save(STEPS.length - 1)
      const r = await post<{ receiptToken: string }>(`${base}/submit`, { revision: revision.current })
      dirty.current = false
      navigate(`/response/${r.receiptToken}`, { replace: true, state: { justSubmitted: true } })
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'Could not send. Your answers are still here; please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function openReceipt() {
    try {
      const r = await post<{ receiptToken: string }>(`${base}/submit`, { revision: revision.current })
      navigate(`/response/${r.receiptToken}`)
    } catch (e) {
      setSubmitError((e as Error).message)
    }
  }

  // ---- render ---------------------------------------------------------------------------------

  if (loadError) return <LinkUnavailable message={loadError} />
  if (!view || !draft) return <Loading />

  async function reopen() {
    setReopening(true)
    setSubmitError(null)
    try {
      await post(`${base}/reopen`)
      await load()
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setReopening(false)
    }
  }

  if (!view.editable) {
    const submitted = view.response?.status === 'submitted'
    const awaitingSignIn = view.signIn.required && !view.signIn.signedIn
    const signInLink = (
      <Link className="btn secondary" to={`/signin?next=${encodeURIComponent('/my-reviews')}`}>
        Sign in to edit my review
      </Link>
    )
    if (view.response?.status === 'changes_requested' && awaitingSignIn) {
      return (
        <main className="calm">
          <div className="narrow stack" style={{ padding: '4rem 0' }}>
            <p className="eyebrow">{view.retreat.title}</p>
            <h1>Your review is open for changes</h1>
            {view.response.organiserMessage && (
              <div className="notice warn">
                <strong>A note from the organiser:</strong> {view.response.organiserMessage}
              </div>
            )}
            <p>Because you’ve already sent this review, please sign in with the email address your invitation was sent to before changing it. This keeps anyone else with your link from altering your words.</p>
            {signInLink}
          </div>
        </main>
      )
    }
    return (
      <main className="calm">
        <div className="narrow" style={{ padding: '4rem 0' }}>
          {viaSignIn && (
            <Link to="/my-reviews" className="small" style={{ display: 'inline-block', marginBottom: '1.5rem' }}>
              ← My reviews
            </Link>
          )}
          <p className="eyebrow">{view.retreat.title}</p>
          <h1>{submitted ? `Thank you, ${view.firstName}` : 'This form is closed'}</h1>
          {submitted ? (
            <>
              <p>Your response has been sent. You can view it, change your permissions or ask for an edit from your private response page.</p>
              <div className="row">
                <button className="btn" onClick={openReceipt}>
                  Open my private response page
                </button>
                {view.signIn.canReopen &&
                  (view.signIn.signedIn ? (
                    <button className="btn secondary" onClick={reopen} disabled={reopening}>
                      {reopening ? 'Opening…' : 'Edit my review'}
                    </button>
                  ) : (
                    signInLink
                  ))}
              </div>
              {view.signIn.canReopen && (
                <p className="small muted" style={{ marginTop: '1rem' }}>
                  {view.signIn.signedIn
                    ? 'Editing reopens your review. If it’s already published, the published version stays up until the organiser approves your changes.'
                    : 'To change a review you’ve already sent, sign in with the email address your invitation was sent to.'}
                </p>
              )}
              <p className="small muted" style={{ marginTop: '1rem' }}>
                This creates a fresh private link; any earlier response link stops working.
              </p>
            </>
          ) : (
            <p>Responses for this retreat are not being collected at the moment. Please contact {view.retreat.organiserName || 'the organiser'} if you think this is a mistake.</p>
          )}
          {submitError && <div className="notice error" role="alert">{submitError}</div>}
        </div>
      </main>
    )
  }

  const c = draft.consents
  const isProperty = view.retreat.kind === 'property'
  const visit = isProperty ? 'stay' : 'retreat'
  const dates = formatRange(view.retreat.startDate, view.retreat.endDate)
  const saveLabel: Record<SaveState, ReactNode> = {
    idle: dirty.current ? 'Unsaved changes' : savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '',
    saving: 'Saving…',
    saved: `Saved ${savedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? ''}`,
    error: (
      <>
        Not saved. Your text is still here.{' '}
        <button type="button" className="btn ghost small" onClick={() => void save().catch(() => {})}>
          Try again
        </button>
      </>
    ),
    conflict: (
      <>
        Changed on another device.{' '}
        <button type="button" className="btn ghost small" onClick={() => void load()}>
          Load latest
        </button>
      </>
    ),
  }

  return (
    <div className="calm">
      <div className="flow">
        <PhotoPanel
          slides={view.retreat.slideshow}
          header={
            <>
              <p className="eyebrow" style={{ color: 'var(--canvas)', opacity: 0.85 }}>
                {view.retreat.organisationName}
              </p>
              <p className="serif" style={{ fontSize: '1.6rem', lineHeight: 1.25, margin: '0.2rem 0' }}>
                {view.retreat.title}
              </p>
              {dates && <p style={{ opacity: 0.9, margin: 0 }}>{isProperty ? `Your stay: ${dates}` : dates}</p>}
            </>
          }
          footer={
            <p className="small" style={{ opacity: 0.85 }}>
              Nothing you write is published unless you choose to share it, and the organiser approves it.
            </p>
          }
        />

        <main className="flow-main" id="main">
          {viaSignIn && (
            <Link to="/my-reviews" className="small" style={{ display: 'inline-block', marginBottom: '1rem' }}>
              ← My reviews
            </Link>
          )}
          {step > 0 && (
            <div aria-hidden="true" className="progress">
              {STEPS.slice(1).map((s, i) => (
                <span key={s} className={i < step ? 'done' : ''} />
              ))}
            </div>
          )}
          {step > 0 && (
            <p className="small muted" style={{ marginTop: 0 }}>
              Step {step} of {STEPS.length - 1}: {STEPS[step]}
            </p>
          )}
          {view.response?.status === 'changes_requested' && view.response.organiserMessage && (
            <div className="notice warn" style={{ marginBottom: '1.5rem' }}>
              <strong>A note from the organiser:</strong> {view.response.organiserMessage}
              <br />
              <span className="small">Your words are only ever changed by you. Edit anything you like and send again.</span>
            </div>
          )}

          {step === 0 && (
            <section className="stack" aria-labelledby="step-heading">
              <h1 id="step-heading" ref={headingRef} tabIndex={-1}>
                Hello {view.firstName}, how was your {visit}?
              </h1>
              {view.retreat.opening && (view.retreat.opening.headline || view.retreat.opening.introParagraphs.length > 0) && (
                <section className="organiser-opening" aria-label={`A message from ${view.retreat.organiserName || view.retreat.organisationName}`}>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    From {view.retreat.organiserName || view.retreat.organisationName}
                  </p>
                  {view.retreat.opening.headline && <h2 className="serif">{view.retreat.opening.headline}</h2>}
                  {view.retreat.opening.introParagraphs.filter((p) => p.trim()).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </section>
              )}
              <p style={{ fontSize: '1.15rem' }}>
                We’d love to hear about your time {isProperty ? 'at' : 'on the'} {view.retreat.title}. It takes about seven minutes, and every question is
                optional.
              </p>
              <ul className="muted">
                <li>A story others could read, if you choose to share it</li>
                <li>Private feedback for the organisers only</li>
                <li>An optional anonymous note, sent separately</li>
                <li>Photos, only with your permission for each one</li>
              </ul>
              <p className="small muted">
                Your answers save as you go, so you can come back to this link on any device. Read how {view.retreat.organisationName} uses your
                information in the{' '}
                <a href={view.retreat.privacyNoticePath} target="_blank" rel="noopener noreferrer">
                  privacy notice
                </a>
                .
              </p>
              <div className="flow-actions">
                <span />
                <button className="btn" onClick={() => goTo(1)}>
                  Begin reflection
                </button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="step-heading">
              <h1 id="step-heading" ref={headingRef} tabIndex={-1}>
                Your story
              </h1>
              <p className="muted">
                Write in your own words. If you choose to share it later, others considering {isProperty ? 'a stay here' : 'a retreat'} may read it.
              </p>
              <div className="panel-sage small" style={{ marginBottom: '1rem' }}>
                <strong>Some prompts, if helpful:</strong>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                  {storyPromptsFor(view.retreat.kind).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <Field id="story" label="Your story (optional)">
                <textarea id="story" value={draft.storyText} maxLength={8000} onChange={(e) => update({ storyText: e.target.value })} style={{ minHeight: '16rem' }} />
              </Field>
              <RatingScale
                legend={`Overall, how was the ${visit} for you? (optional)`}
                value={draft.overallRating}
                allowNotApplicable={false}
                onChange={({ score }) => update({ overallRating: score })}
              />
              <Actions step={step} goTo={goTo} saveLabel={saveLabel[saveState]} />
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="step-heading">
              <h1 id="step-heading" ref={headingRef} tabIndex={-1}>
                Private feedback
              </h1>
              <p className="muted">
                Only the {isProperty ? 'property team' : 'organisers'} see this. It’s never published, and it helps shape {isProperty ? 'future stays' : 'the next retreat'}. Skip
                anything that doesn’t apply.
              </p>
              <div className="stack">
                {view.retreat.categories.map((cat) => {
                  const r = draft.ratings[cat.key]
                  return (
                    <div key={cat.key} className="card tight">
                      <RatingScale
                        legend={cat.label}
                        value={r.score}
                        notApplicable={r.notApplicable}
                        onChange={(v) => update({ ratings: { ...draft.ratings, [cat.key]: { ...r, ...v } } })}
                      />
                      <details style={{ marginTop: '0.5rem' }} open={Boolean(r.comment)}>
                        <summary className="small" style={{ cursor: 'pointer' }}>
                          Add a comment
                        </summary>
                        <label htmlFor={`c-${cat.key}`} className="sr-only">
                          Comment on {cat.label}
                        </label>
                        <textarea
                          id={`c-${cat.key}`}
                          value={r.comment}
                          maxLength={1000}
                          onChange={(e) => update({ ratings: { ...draft.ratings, [cat.key]: { ...r, comment: e.target.value } } })}
                          style={{ minHeight: '5rem', marginTop: '0.5rem' }}
                        />
                      </details>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: '1.5rem' }}>
                <Field id="keep" label="What should we definitely keep?">
                  <textarea id="keep" value={draft.keepText} maxLength={2000} onChange={(e) => update({ keepText: e.target.value })} style={{ minHeight: '6rem' }} />
                </Field>
                <Field id="change" label={isProperty ? 'What would have made your stay even better?' : 'What would you change for the next retreat?'}>
                  <textarea id="change" value={draft.changeText} maxLength={2000} onChange={(e) => update({ changeText: e.target.value })} style={{ minHeight: '6rem' }} />
                </Field>
                <Switch
                  checked={c.followUp}
                  onChange={(v) => update({ consents: { ...c, followUp: v } })}
                  label="I’m happy to be contacted about my private feedback"
                  description={CONSENT_WORDING.followUp}
                />
              </div>
              <Actions step={step} goTo={goTo} saveLabel={saveLabel[saveState]} />
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="step-heading" className="stack">
              <h1 id="step-heading" ref={headingRef} tabIndex={-1}>
                Something you’d rather say anonymously?
              </h1>
              <p>
                You can send a separate note without your name. It opens on its own page, isn’t saved with this response, and the organiser can’t link it
                back to you.
              </p>
              <p className="small muted">Details you write in the note itself may still identify you, so we don’t promise absolute anonymity.</p>
              <a className="btn secondary" href={view.retreat.anonymousPath} target="_blank" rel="noopener noreferrer">
                Open the anonymous note page ↗
              </a>
              <Actions step={step} goTo={goTo} saveLabel={saveLabel[saveState]} nextLabel="Continue" />
            </section>
          )}

          {step === 4 && (
            <section aria-labelledby="step-heading">
              <h1 id="step-heading" ref={headingRef} tabIndex={-1}>
                Photos and permissions
              </h1>
              <p className="muted">
                Everything starts switched off. Each choice is separate, declining any of them never affects your private feedback, and you can withdraw
                any of them later from your private response page.{' '}
                <a href={view.retreat.privacyNoticePath} target="_blank" rel="noopener noreferrer">
                  How your information is used
                </a>
              </p>
              <h2 style={{ fontSize: '1.3rem', marginTop: '1.5rem' }}>Your words</h2>
              <Switch
                checked={c.publicText}
                disabled={!draft.storyText.trim()}
                onChange={(v) => update({ consents: { ...c, publicText: v, firstName: v ? c.firstName : false } })}
                label="Publish my story on the retreat review site"
                description={draft.storyText.trim() ? CONSENT_WORDING.publicText : 'You haven’t written a story, so there’s nothing to publish.'}
              />
              <Switch
                checked={c.firstName}
                disabled={!c.publicText}
                onChange={(v) => update({ consents: { ...c, firstName: v } })}
                label={`Show my first name (“${view.firstName}”) with it`}
                description={CONSENT_WORDING.firstName}
              />
              <Switch
                checked={c.marketing}
                onChange={(v) => update({ consents: { ...c, marketing: v } })}
                label="Allow reuse in social media or advertising"
                description="Separate from the website. Off unless you choose it."
              />
              <h2 style={{ fontSize: '1.3rem', marginTop: '2rem' }}>Photos (optional)</h2>
              <p className="small muted">
                If others appear in a photo, please only share it if they’re happy for it to be seen. The organiser checks every photo before it’s
                published, and location and camera details are removed.
              </p>
              <PhotoManager base={base} photos={photos} setPhotos={setPhotos} />
              <Actions step={step} goTo={goTo} saveLabel={saveLabel[saveState]} nextLabel="Review" />
            </section>
          )}

          {step === 5 && (
            <section aria-labelledby="step-heading">
              <h1 id="step-heading" ref={headingRef} tabIndex={-1}>
                Review and send
              </h1>
              <h2 style={{ fontSize: '1.2rem' }}>What could appear publicly</h2>
              {c.publicText && draft.storyText.trim() ? (
                <div className="card" style={{ background: 'var(--surface)' }}>
                  <p className="eyebrow">Preview, if the organiser approves it</p>
                  <p className="serif" style={{ whiteSpace: 'pre-line', fontSize: '1.15rem' }}>
                    {draft.storyText}
                  </p>
                  <p className="muted">— {c.firstName ? view.firstName : 'A retreat guest'}</p>
                  {photos.filter((p) => p.publishConsent).length > 0 && (
                    <div className="photo-grid">
                      {photos
                        .filter((p) => p.publishConsent)
                        .map((p) => (
                          <img key={p.id} src={`${base}/photos/${p.id}/image`} alt={p.altText || 'Your photo'} />
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="notice">Nothing will be published. Your response stays private to the organisers.</p>
              )}
              <h2 style={{ fontSize: '1.2rem', marginTop: '1.5rem' }}>Private to the organisers</h2>
              <ul className="muted">
                <li>{Object.values(draft.ratings).filter((r) => r.score || r.notApplicable).length} of {view.retreat.categories.length} feedback areas answered</li>
                <li>{draft.keepText || draft.changeText ? 'Your keep / change answers' : 'No keep / change answers'}</li>
                <li>{c.followUp ? 'Happy to be contacted' : 'Not to be contacted'}</li>
                <li>{photos.length} photo{photos.length === 1 ? '' : 's'} ({photos.filter((p) => p.publishConsent).length} with publishing permission)</li>
              </ul>
              {submitError && <div className="notice error" role="alert">{submitError}</div>}
              <div className="flow-actions">
                <button className="btn secondary" onClick={() => goTo(4)}>
                  Back
                </button>
                <span className="save-state" aria-live="polite">
                  {saveLabel[saveState]}
                </span>
                <button className="btn" onClick={submit} disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send my response'}
                </button>
              </div>
              <p className="small muted" style={{ marginTop: '1rem' }}>
                After sending you’ll get a private link to view your response, change your permissions or ask for an edit.
                {' '}
                <a href={view.retreat.privacyNoticePath} target="_blank" rel="noopener noreferrer">
                  Privacy notice
                </a>
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

function Actions({ step, goTo, saveLabel, nextLabel = 'Continue' }: { step: number; goTo: (n: number) => void; saveLabel: ReactNode; nextLabel?: string }) {
  return (
    <div className="flow-actions">
      <button className="btn secondary" onClick={() => goTo(step - 1)}>
        Back
      </button>
      <span className="save-state" aria-live="polite">
        {saveLabel}
      </span>
      <button className="btn" onClick={() => goTo(step + 1)}>
        {nextLabel}
      </button>
    </div>
  )
}

function PhotoManager({ base, photos, setPhotos }: { base: string; photos: Photo[]; setPhotos: (p: Photo[]) => void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    setUploading(true)
    let next = photos
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('photo', file)
      try {
        const p = await api<Photo>('POST', `${base}/photos`, fd)
        next = [...next, p]
        setPhotos(next)
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`)
      }
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function change(p: Photo, patchBody: Partial<Photo>) {
    const optimistic = photos.map((x) => (x.id === p.id ? { ...x, ...patchBody } : x))
    setPhotos(optimistic)
    try {
      await patch(`${base}/photos/${p.id}`, patchBody)
    } catch (e) {
      setError((e as Error).message)
      setPhotos(photos)
    }
  }

  async function remove(p: Photo) {
    try {
      await del(`${base}/photos/${p.id}`)
      setPhotos(photos.filter((x) => x.id !== p.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="stack">
      {error && <div className="notice error" role="alert">{error}</div>}
      <div>
        <label htmlFor="photo-input" className="btn secondary">
          {uploading ? 'Uploading…' : 'Add photos'}
        </label>
        <input
          ref={inputRef}
          id="photo-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          className="sr-only"
          disabled={uploading}
          onChange={(e) => void onFiles(e.target.files)}
        />
        <span className="small muted" style={{ marginLeft: '0.75rem' }} role="status">
          {uploading ? 'Uploading, please keep this page open.' : 'JPEG, PNG, WebP or HEIC.'}
        </span>
      </div>
      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p, i) => (
            <div key={p.id} className="card tight">
              <img src={`${base}/photos/${p.id}/image`} alt={p.altText || `Your photo ${i + 1}`} />
              <Field id={`alt-${p.id}`} label="Describe the photo (for screen readers)">
                <input id={`alt-${p.id}`} type="text" defaultValue={p.altText} maxLength={300} onBlur={(e) => e.target.value !== p.altText && void change(p, { altText: e.target.value })} />
              </Field>
              <Switch checked={p.publishConsent} onChange={(v) => void change(p, { publishConsent: v })} label="May be published with my story" description={CONSENT_WORDING.photo} />
              <button className="btn ghost small" onClick={() => void remove(p)}>
                Remove photo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
