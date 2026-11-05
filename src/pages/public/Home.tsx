import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { REVIEW_KINDS, type ReviewKind } from '../../../shared/categories'
import { ApiError, get, post } from '../../lib/api'
import { Field } from '../../components/Controls'
import { Loading } from '../../components/States'
import { OrgSite } from './OrgHome'

interface SiteInfo {
  mode: 'platform' | 'tenant'
  org?: { slug: string; name: string }
}

/** `/` serves a tenant's site on its custom domain, and the croot landing page everywhere else. */
export function Home() {
  const site = useQuery({ queryKey: ['site'], queryFn: () => get<SiteInfo>('/api/public/site') })
  if (site.isLoading) return <Loading />
  if (site.data?.mode === 'tenant' && site.data.org) return <OrgSite orgSlug={site.data.org.slug} />
  return <Landing />
}

const TYPES: Array<{
  kind: ReviewKind
  eyebrow: string
  title: string
  pitch: string
  who: string
  points: string[]
}> = [
  {
    kind: 'itinerary',
    eyebrow: 'For hosted journeys',
    title: 'Itinerary retreats',
    pitch: 'You led a group through a planned journey, like a ten-day yoga tour across Delhi, Agra and the Himalayan foothills.',
    who: 'Yoga teachers, retreat leaders, wellness travel companies',
    points: [
      'One cohort with fixed dates and a route',
      'Feedback on teaching, excursions, transfers and the group',
      'A showcase built around the journey and its itinerary',
    ],
  },
  {
    kind: 'property',
    eyebrow: 'For venues',
    title: 'Retreat properties',
    pitch: 'Guests come and go all year: an ashram, an eco-lodge, a wellness hotel or a farmhouse retreat centre.',
    who: 'Property owners, managers and resident hosts',
    points: [
      'Rolling invitations, each with the guest’s own stay dates',
      'Feedback on rooms, cleanliness, food, staff and calm',
      'A living showcase of the place, refreshed as stays happen',
    ],
  },
]

const COMPARISON: Array<[string, string, string]> = [
  ['Who is invited', 'Everyone who travelled on that retreat', 'Each guest after their own stay'],
  ['Dates', 'The retreat’s fixed start and end', 'Per-guest check-in and check-out (kept private)'],
  ['Public details', 'Dates, route and itinerary', 'Location, highlights and property website'],
  ['Default feedback areas', 'Instruction, excursions, transfers, group, value', 'Arrival, rooms, cleanliness, food, staff, calm, value'],
  ['Story prompts', '“What moment has stayed with you?”', '“What made your stay feel restorative?”'],
]

function Landing() {
  const [preselect, setPreselect] = useState<ReviewKind | null>(null)
  return (
    <div className="calm landing">
      <a href="#request" className="skip-link">
        Skip to request form
      </a>
      <header className="container site-header spread">
        <span className="brand"><img className="brand-logo" src="/croot-logo.svg" alt="Croot" /></span>
        <nav className="row" aria-label="Main">
          <a href="#types">Review types</a>
          <a href="#how">How it works</a>
          <a href="#request">Request access</a>
          <Link to="/signin" className="btn secondary small">
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        <section className="container hero landing-hero">
          <p className="eyebrow">Reviews for retreat organisers and retreat properties</p>
          <h1>Guest stories that stay true to the people who wrote them.</h1>
          <p className="lead">
            Invite every guest to share a public story, honest private feedback and an optional anonymous note, each kept separate. Nothing is published
            without the guest’s explicit consent and your approval.
          </p>
          <div className="row">
            <a className="btn" href="#request">
              Request access
            </a>
            <a className="btn secondary" href="#types">
              Which type am I?
            </a>
          </div>
        </section>

        <section id="types" className="container" aria-labelledby="types-heading">
          <h2 id="types-heading">Two ways to collect reviews</h2>
          <p className="muted" style={{ maxWidth: '62ch' }}>
            Choose the type that matches how your guests experience you. One account can run both, for example a venue that also leads an annual
            journey.
          </p>
          <div className="type-cards">
            {TYPES.map((t) => (
              <article key={t.kind} className="type-card" aria-labelledby={`type-${t.kind}`}>
                <p className="eyebrow">{t.eyebrow}</p>
                <h3 id={`type-${t.kind}`}>{t.title}</h3>
                <p>{t.pitch}</p>
                <ul>
                  {t.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="small muted">Ideal for: {t.who}</p>
                <a className="btn secondary" href="#request" onClick={() => setPreselect(t.kind)}>
                  Get started with {t.title.toLowerCase()}
                </a>
              </article>
            ))}
          </div>

          <div className="table-wrap card" style={{ marginTop: '1.5rem' }}>
            <table className="data">
              <caption className="sr-only">How the two review types differ</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Aspect</span>
                  </th>
                  <th scope="col">{REVIEW_KINDS.itinerary.label}</th>
                  <th scope="col">{REVIEW_KINDS.property.label}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([aspect, a, b]) => (
                  <tr key={aspect}>
                    <th scope="row">{aspect}</th>
                    <td>{a}</td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="how" className="container" style={{ marginTop: '4rem' }} aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <ol className="steps">
            {[
              ['Add your guests', 'Paste a guest list. Each guest gets their own private link, with no account or password.'],
              ['Guests reflect', 'About seven minutes: a story, private ratings with “not applicable”, photos and permissions. Every question is optional.'],
              ['You review', 'Read private feedback, check every photo and publish only what guests agreed to share, word for word.'],
              ['Share the showcase', 'Your own opening words, then guest stories in an accessible, themeable sequence on your own domain.'],
            ].map(([title, body], i) => (
              <li key={title} className="card">
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{title}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="container" style={{ marginTop: '4rem' }} aria-labelledby="trust-heading">
          <div className="panel-sage">
            <h2 id="trust-heading">Built around guest consent</h2>
            <div className="grid-2">
              {[
                ['Separate permissions', 'Story text, first name, each photo and marketing reuse are separate choices, and all start switched off.'],
                ['Never rewritten', 'Organisers can’t edit a guest’s words. They can ask the guest, who makes any change themselves.'],
                ['Truly separate anonymous notes', 'Stored without name, email, invitation or precise time, so they can’t be traced back through croot.'],
                ['Withdraw any time', 'Guests have a private page to withdraw permissions. Public pages update immediately.'],
              ].map(([t, b]) => (
                <div key={t}>
                  <h3>{t}</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    {b}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="request" className="narrow" style={{ padding: '4rem 0' }}>
          <RequestAccess key={preselect ?? 'none'} preselect={preselect} />
        </section>
      </main>

      <footer className="site-footer">
        <div className="container spread small muted">
          <span>croot · retreat stories, shared with permission</span>
          <nav className="row" aria-label="Legal">
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/terms">Data processing terms</Link>
            <Link to="/legal/cookies">Cookies</Link>
            <Link to="/signin">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

function RequestAccess({ preselect }: { preselect: ReviewKind | null }) {
  const [form, setForm] = useState({ orgName: '', contactName: '', email: '', websiteUrl: '', message: '' })
  const [kinds, setKinds] = useState<ReviewKind[]>(preselect ? [preselect] : [])
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!kinds.length) {
      setErrors({ reviewKinds: ['Choose at least one type of review'] })
      setState('error')
      setMessage('Some fields need attention')
      return
    }
    setState('sending')
    setErrors({})
    try {
      await post('/api/public/tenant-requests', { ...form, reviewKinds: kinds, acceptTerms: accepted || undefined })
      setState('sent')
    } catch (err) {
      setState('error')
      setMessage((err as Error).message)
      if (err instanceof ApiError && err.details) setErrors(err.details)
    }
  }

  if (state === 'sent') {
    return (
      <div className="card" role="status">
        <h2>Thank you</h2>
        <p>We’ve received your request and will be in touch by email to set up your workspace.</p>
      </div>
    )
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const toggle = (k: ReviewKind) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Request access</h2>
      <p className="muted">Tell us a little about what you run. A person reviews every request.</p>
      {state === 'error' && (
        <div className="notice error" role="alert">
          {message}
        </div>
      )}
      <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 1rem' }} aria-describedby={errors.reviewKinds ? 'kinds-error' : undefined}>
        <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>What would you like to collect reviews for?</legend>
        <div className="kind-choices">
          {(Object.keys(REVIEW_KINDS) as ReviewKind[]).map((k) => (
            <label key={k} className={`kind-choice ${kinds.includes(k) ? 'selected' : ''}`}>
              <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} />
              <span>
                <strong>{REVIEW_KINDS[k].label}</strong>
                <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>
                  {REVIEW_KINDS[k].description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.reviewKinds && (
          <span className="error" id="kinds-error">
            {errors.reviewKinds[0]}
          </span>
        )}
      </fieldset>
      <Field id="orgName" label="Business, retreat or property name" error={errors.orgName?.[0]}>
        <input id="orgName" type="text" value={form.orgName} onChange={set('orgName')} required aria-invalid={Boolean(errors.orgName)} />
      </Field>
      <Field id="contactName" label="Your name" error={errors.contactName?.[0]}>
        <input id="contactName" type="text" autoComplete="name" value={form.contactName} onChange={set('contactName')} required aria-invalid={Boolean(errors.contactName)} />
      </Field>
      <Field id="email" label="Email" error={errors.email?.[0]}>
        <input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required aria-invalid={Boolean(errors.email)} />
      </Field>
      <Field id="websiteUrl" label="Website (optional)" error={errors.websiteUrl?.[0]}>
        <input id="websiteUrl" type="url" value={form.websiteUrl} onChange={set('websiteUrl')} placeholder="https://" />
      </Field>
      <Field id="message" label="Anything else? (optional)" hint="For example, how many retreats or rooms you run.">
        <textarea id="message" value={form.message} onChange={set('message')} style={{ minHeight: '6rem' }} />
      </Field>
      <div className="field">
        <label className="kind-choice" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} aria-invalid={Boolean(errors.acceptTerms)} />
          <span>
            I’ve read the <Link to="/legal/privacy" target="_blank">privacy notice</Link>, which explains how we use the details in this form, and the{' '}
            <Link to="/legal/terms" target="_blank">data processing terms</Link> that will apply to my guests’ data.
          </span>
        </label>
        {errors.acceptTerms && <span className="error">{errors.acceptTerms[0]}</span>}
      </div>
      <button className="btn" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send request'}
      </button>
    </form>
  )
}
