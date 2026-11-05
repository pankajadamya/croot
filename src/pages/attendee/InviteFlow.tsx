import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { CONSENT_WORDING, storyPromptsFor, type FeedbackCategory, type ReviewKind } from '../../../shared/categories'
import { api, ApiError, del, get, patch, post, put } from '../../lib/api'
import { formatRange } from '../../lib/format'
import { Field, Switch } from '../../components/Controls'
import { StarInput } from '../../components/Stars'
import { LinkUnavailable, Loading } from '../../components/States'
import { PhotoPanel } from './PhotoPanel'
import { AlbumLinkCard, AlbumTeaser, type AlbumSummary } from '../../components/AlbumGallery'
import { RetreatPageLink } from '../../components/RetreatPageLink'

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
  albumConsent?: boolean
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
    anonymousNotePath: string
    publicPagePath: string | null
    privacyNoticePath: string
    slideshow: Array<{ url: string; alt: string; caption: string }>
    opening: { headline: string; introParagraphs: string[] } | null
    album: AlbumSummary | null
  }
  stay: { start: string | null; end: string | null } | null
  response: {
    status: 'draft' | 'submitted' | 'changes_requested' | 'withdrawn'
    revision: number
    currentStep: number
    storyTitle: string
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
  storyTitle: string
  storyText: string
  overallRating: number | null
  keepText: string
  changeText: string
  consents: Consents
  ratings: Record<string, Rating>
  /** Property stays only: check-in / check-out as YYYY-MM-DD ('' when not given). */
  stay: { start: string; end: string }
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
    storyTitle: r?.storyTitle ?? '',
    storyText: r?.storyText ?? '',
    overallRating: r?.overallRating ?? null,
    keepText: r?.keepText ?? '',
    changeText: r?.changeText ?? '',
    consents: r?.consents ?? { publicText: false, firstName: false, followUp: false, marketing: false },
    ratings,
    stay: { start: view.stay?.start?.slice(0, 10) ?? '', end: view.stay?.end?.slice(0, 10) ?? '' },
  }
}

/** The full-page album for whichever way the guest reached their review. */
function albumPagePath(base: string) {
  return base.replace(/^\/api\/invites\//, '/invite/').replace(/^\/api\/me\/reviews\//, '/my-reviews/') + '/album'
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
  // The furthest step reached, so the step bar can jump back to any of them.
  const [furthest, setFurthest] = useState(0)
  useEffect(() => setFurthest((f) => Math.max(f, step)), [step])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The anonymous note lives only in this browser tab: never in the auto-saved draft, which belongs to this
  // guest. It is kept in this tab's session storage so a refresh doesn't lose it, with a random one-time key
  // so a retried send can't create a duplicate.
  const noteStore = `croot.note.${base}`
  const [anonNote, setAnonNoteState] = useState(() => readNote(noteStore).text)
  const [noteSent, setNoteSent] = useState(() => readNote(noteStore).sent)
  const setAnonNote = (text: string) => {
    setAnonNoteState(text)
    setNoteSent(false)
    writeNote(noteStore, { text, sent: false, key: readNote(noteStore).key || newSendKey() })
  }
  const anonRef = useRef(anonNote)
  anonRef.current = noteSent ? '' : anonNote
  const location = useLocation()
  const [params] = useSearchParams()
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

  // Back from signing in to edit (?edit=1): reopen the sent review straight away, then drop the flag.
  const autoEdit = useRef(false)
  useEffect(() => {
    if (!view || autoEdit.current || params.get('edit') !== '1') return
    autoEdit.current = true
    navigate(location.pathname, { replace: true })
    if (view.response?.status === 'submitted' && view.signIn.signedIn && view.signIn.canReopen) {
      post(`${base}/reopen`)
        .then(() => load())
        .catch((e: Error) => setSubmitError(e.message))
    }
  }, [view, params, navigate, location.pathname, base, load])

  // ---- saving ---------------------------------------------------------------------------------

  const save = useCallback(
    async (nextStep?: number) => {
      if (!draft || !view?.editable) return
      if (saving.current) await saving.current.catch(() => {})
      const body = {
        revision: revision.current,
        currentStep: nextStep ?? step,
        storyTitle: draft.storyTitle,
        storyText: draft.storyText,
        overallRating: draft.overallRating,
        keepText: draft.keepText,
        changeText: draft.changeText,
        consents: draft.consents,
        ...(view.stay ? { stay: { start: draft.stay.start || null, end: draft.stay.end || null } } : {}),
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

  // Warn before leaving with unsaved text, including an anonymous note that hasn't been sent yet.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current || anonRef.current.trim()) e.preventDefault()
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

  /**
   * Sends the anonymous note on its own: a separate request with no invite token and no cookies, so
   * nothing in it says who wrote it. The server keeps only the words.
   */
  async function sendAnonymousNote() {
    const message = anonNote.trim()
    if (!message || !view || noteSent) return
    const stored = readNote(noteStore)
    const sendKey = stored.key || newSendKey()
    const res = await fetch(view.retreat.anonymousNotePath, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sendKey }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new ApiError(res.status, `Your anonymous note couldn’t be sent: ${body?.error ?? 'please try again'}`)
    }
    setNoteSent(true)
    writeNote(noteStore, { text: message, sent: true, key: sendKey })
  }

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await sendAnonymousNote()
      await save(STEPS.length - 1)
      const r = await post<{ receiptToken: string }>(`${base}/submit`, { revision: revision.current })
      dirty.current = false
      clearNote(noteStore)
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
  const wantsEdit = params.get('edit') === '1'

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
    // Sign-in comes straight back here and opens the review for editing.
    const signInLink = (
      <Link className="btn secondary" to={`/signin?next=${encodeURIComponent(`${location.pathname}?edit=1`)}`}>
        Sign in to edit my review
      </Link>
    )
    if (wantsEdit && view.signIn.signedIn && view.signIn.canReopen && submitted && !submitError) return <Loading />
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
              {view.retreat.album?.unlocked && (
                <div style={{ margin: '1.5rem 0' }}>
                  <AlbumLinkCard album={view.retreat.album} href={albumPagePath(base)} />
                </div>
              )}
              <div style={{ margin: '1.5rem 0' }}>
                <RetreatPageLink href={view.retreat.publicPagePath} title={view.retreat.title} />
              </div>
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
            </>
          ) : (
            <>
              <p>Responses for this retreat are not being collected at the moment. Please contact {view.retreat.organiserName || 'the organiser'} if you think this is a mistake.</p>
              <div className="row">
                {view.retreat.publicPagePath && (
                  <Link className="btn secondary" to={view.retreat.publicPagePath}>
                    See the retreat page
                  </Link>
                )}
                <Link className="btn ghost" to="/">
                  Croot home
                </Link>
              </div>
            </>
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
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            if (window.confirm('Load the version from your other device? Changes you made here since your last save will be replaced.')) void load()
          }}
        >
          Load latest
        </button>
      </>
    ),
  }

  return (
    <div className="calm">
      <div className="flow">
        <PhotoPanel
          compactOnMobile={step > 0}
          slides={view.retreat.slideshow}
          header={
            <>
              <img className="flow-croot" src="/croot-logo-light.svg" alt="Croot" />
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
            <nav className="progress" aria-label="Steps">
              {STEPS.slice(1).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`progress-step ${i < step ? 'done' : ''} ${i + 1 === step ? 'current' : ''}`}
                  aria-label={`Step ${i + 1}: ${s}`}
                  aria-current={i + 1 === step ? 'step' : undefined}
                  disabled={i + 1 > furthest || i + 1 === step}
                  onClick={() => void goTo(i + 1)}
                />
              ))}
            </nav>
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
                We’d love to hear about your time {isProperty ? 'at' : 'on the'} {view.retreat.title}. Most people take 10 to 15 minutes. Every question is
                optional, and your answers save as you go.
              </p>
              {view.stay && (
                <fieldset className="stay-dates">
                  <legend>When did you stay?</legend>
                  <p className="small muted" style={{ margin: '0 0 0.6rem' }}>
                    {view.stay.start || view.stay.end ? 'Check these are right.' : 'So the team knows which stay you’re reviewing.'} Only the organisers see your dates.
                  </p>
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <Field id="stay-start" label="Check-in">
                      <input id="stay-start" type="date" value={draft.stay.start} max={draft.stay.end || undefined} onChange={(e) => update({ stay: { ...draft.stay, start: e.target.value } })} />
                    </Field>
                    <Field id="stay-end" label="Check-out">
                      <input id="stay-end" type="date" value={draft.stay.end} min={draft.stay.start || undefined} onChange={(e) => update({ stay: { ...draft.stay, end: e.target.value } })} />
                    </Field>
                  </div>
                </fieldset>
              )}
              {view.retreat.album && !view.retreat.album.unlocked && <AlbumTeaser album={view.retreat.album} />}
              <ul className="muted">
                <li>A story others could read, if you choose to share it</li>
                <li>Private feedback for the organisers only</li>
                <li>An optional anonymous note, stored separately with no link to you</li>
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
                  Start
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
              <Field id="story-title" label="A title for your story (optional)" hint="A few words that sum it up, like “The reset I didn’t know I needed”.">
                <input id="story-title" type="text" value={draft.storyTitle} maxLength={120} onChange={(e) => update({ storyTitle: e.target.value })} />
              </Field>
              <Field id="story" label="Your story (optional)">
                <textarea id="story" value={draft.storyText} maxLength={8000} onChange={(e) => update({ storyText: e.target.value })} style={{ minHeight: '16rem' }} />
              </Field>
              <StarInput
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
                anything that doesn’t apply.{' '}
                <button type="button" className="link-button" onClick={() => void goTo(3)}>
                  Skip this section
                </button>
              </p>
              <div className="stack">
                {view.retreat.categories.map((cat) => {
                  const r = draft.ratings[cat.key]
                  return (
                    <div key={cat.key} className="card tight">
                      <StarInput
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
                Write it here and it’s sent separately when you send your review. It’s stored on its own, with no name, link or time of day, so the organiser
                can’t tell who wrote it.
              </p>
              <Field id="anon-note" label="Anonymous note (optional)" hint="It isn’t saved as you go, so it stays in this browser window until you send.">
                <textarea id="anon-note" value={anonNote} maxLength={4000} onChange={(e) => setAnonNote(e.target.value)} style={{ minHeight: '8rem' }} />
              </Field>
              <p className="small muted">Details you write in the note itself may still identify you, so we can’t promise complete anonymity.</p>
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
                If others appear in a photo, please only share it if they’re happy for it to be seen. The organiser checks every photo before it
                appears anywhere, and location and camera details are removed. Up to 8 photos, each up to 15 MB.
              </p>
              <PhotoManager
                base={base}
                photos={photos}
                setPhotos={setPhotos}
                albumAvailable={Boolean(view.retreat.album)}
                storyShared={c.publicText && Boolean(draft.storyText.trim())}
              />
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
                  {draft.storyTitle.trim() && <h3 style={{ margin: '0 0 0.5rem' }}>{draft.storyTitle.trim()}</h3>}
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
              <h2 style={{ fontSize: '1.2rem', marginTop: '1.5rem' }}>Your choices</h2>
              <ul className="muted">
                <li>{c.publicText && draft.storyText.trim() ? 'Your story may be published, if the organiser approves it' : 'Your story stays private'}</li>
                {c.publicText && <li>{c.firstName ? `Shown with your first name, “${view.firstName}”` : 'Shown without your name'}</li>}
                <li>{c.marketing ? 'May be reused in social media or advertising' : 'Not reused in social media or advertising'}</li>
                {photos.length > 0 && (
                  <li>
                    {photos.filter((ph) => ph.publishConsent).length} of {photos.length} photo{photos.length === 1 ? '' : 's'} may be published with your story
                    {view.retreat.album ? `; ${photos.filter((ph) => ph.albumConsent).length} shared in the photo album once approved` : ''}
                  </li>
                )}
              </ul>
              <h2 style={{ fontSize: '1.2rem', marginTop: '1.5rem' }}>Private to the organisers</h2>
              <ul className="muted">
                <li>{Object.values(draft.ratings).filter((r) => r.score || r.notApplicable).length} of {view.retreat.categories.length} feedback areas answered</li>
                <li>{draft.keepText || draft.changeText ? 'Your keep / change answers' : 'No keep / change answers'}</li>
                <li>{c.followUp ? 'Happy to be contacted' : 'Not to be contacted'}</li>
              </ul>
              <h2 style={{ fontSize: '1.2rem', marginTop: '1.5rem' }}>Anonymous</h2>
              <p className="muted">
                {noteSent ? (
                  'Your anonymous note has been sent, separately and with no link to you.'
                ) : (
                  <>
                    {anonNote.trim() ? 'Your anonymous note, sent separately with no link to you.' : 'No anonymous note.'}{' '}
                    <button type="button" className="link-button" onClick={() => goTo(3)}>
                      {anonNote.trim() ? 'Edit' : 'Add one'}
                    </button>
                  </>
                )}
              </p>
              {view.retreat.album && !view.retreat.album.unlocked && (
                <p className="notice ok small">Sending unlocks the retreat photo album, our thank-you whatever you choose to share.</p>
              )}
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

function PhotoManager({
  base,
  photos,
  setPhotos,
  albumAvailable,
  storyShared,
}: {
  base: string
  photos: Photo[]
  setPhotos: (p: Photo[]) => void
  albumAvailable: boolean
  storyShared: boolean
}) {
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
    if (!window.confirm('Remove this photo? It will be deleted.')) return
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
              <Switch
                checked={p.publishConsent && storyShared}
                disabled={!storyShared}
                onChange={(v) => void change(p, { publishConsent: v })}
                label="May be published with my story"
                description={storyShared ? CONSENT_WORDING.photo : 'Only possible if you share your story above.'}
              />
              {albumAvailable && (
                <Switch
                  checked={Boolean(p.albumConsent)}
                  onChange={(v) => void change(p, { albumConsent: v })}
                  label="Also share publicly in the retreat photo album"
                  description={CONSENT_WORDING.albumPhoto}
                />
              )}
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

type StoredNote = { text: string; sent: boolean; key: string }
function readNote(k: string): StoredNote {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(k) ?? 'null') as StoredNote | null
    return v && typeof v.text === 'string' ? v : { text: '', sent: false, key: '' }
  } catch {
    return { text: '', sent: false, key: '' }
  }
}
function writeNote(k: string, v: StoredNote) {
  try {
    if (!v.text) window.sessionStorage.removeItem(k)
    else window.sessionStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage blocked: the note stays in memory */
  }
}
function clearNote(k: string) {
  try {
    window.sessionStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
function newSendKey() {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
