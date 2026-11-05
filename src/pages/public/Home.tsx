import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { REVIEW_KINDS, type ReviewKind } from '../../../shared/categories'
import { get } from '../../lib/api'
import { Loading } from '../../components/States'
import { workspacePath } from '../../components/AppHeader'
import { useAuth } from '../../lib/auth'
import { OrgSite } from './OrgHome'

interface SiteInfo {
  mode: 'platform' | 'tenant'
  org?: { slug: string; name: string }
}

/** `/` serves a tenant's site on its custom domain, and the Croot landing page everywhere else. */
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
  const { session } = useAuth()
  // Signed in: the header leads to your own place instead of asking you to sign in again.
  const account = session
    ? session.user.isPlatformAdmin
      ? { to: '/platform', label: 'Admin' }
      : session.memberships.length
        ? { to: workspacePath(session), label: 'Organiser workspace' }
        : { to: '/my-reviews', label: 'My reviews' }
    : { to: '/signin', label: 'Sign in' }
  // Getting started: sign up (any email or Google), then ask to become an organiser.
  const startPath = session ? '/organiser/request' : '/signin?next=%2Forganiser%2Frequest'
  return (
    <div className="calm landing">
      <a href="#get-started" className="skip-link">
        Skip to getting started
      </a>
      <header className="container site-header spread">
        <span className="brand"><img className="brand-logo" src="/croot-logo.svg" alt="Croot" /></span>
        <nav className="row" aria-label="Main">
          <a href="#types">Review types</a>
          <a href="#how">How it works</a>
          <a href="#get-started">Get started</a>
          <Link to={account.to} className="btn secondary small">
            {account.label}
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
            <a className="btn" href="#get-started">
              Get started
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
                <a className="btn secondary" href="#get-started">
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
                ['Truly separate anonymous notes', 'Stored without name, email, invitation or precise time, so they can’t be traced back through Croot.'],
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

        <section id="get-started" className="narrow" style={{ padding: '4rem 0' }} aria-labelledby="get-started-heading">
          <div className="card stack">
            <h2 id="get-started-heading">Get started as an organiser</h2>
            <ol className="muted" style={{ paddingLeft: '1.2rem', margin: 0 }}>
              <li>Create your account with your email (we send a code) or Google.</li>
              <li>Tell us about your retreats or property: a short form.</li>
              <li>A person at Croot reviews it, usually within a couple of working days, and emails you.</li>
            </ol>
            <p className="small muted" style={{ margin: 0 }}>
              Been sent an invitation link? Just open it: you’ll be set up straight away.
            </p>
            <div>
              <Link className="btn" to={startPath}>
                {session ? 'Become an organiser' : 'Create your account'}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container spread small muted">
          <span>Croot · retreat stories, shared with permission</span>
          <nav className="row" aria-label="Legal">
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/terms">Data processing terms</Link>
            <Link to="/legal/cookies">Cookies</Link>
            <Link to={account.to}>{account.label}</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
