import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { formatRange } from '../lib/format'

export interface RetreatFacts {
  slug: string
  kind: 'itinerary' | 'property'
  title: string
  startDate: string | null
  endDate: string | null
  locationSummary: string
  routeSummary: string[]
  propertyAddress: string | null
  amenities: string[]
  itineraryUrl: string | null
  retreatPageUrl: string | null
  organiserName: string
  contact: { email: string | null; phone: string | null } | null
  privacyUrl: string | null
}

/** Small line icons (24px grid, drawn with the current text colour). */
const ICONS: Record<string, ReactNode> = {
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5z" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  phone: <path d="M6.6 3.8 9 4.4l1.2 4-1.9 1.4a12 12 0 0 0 5.9 5.9l1.4-1.9 4 1.2.6 2.4c.2.9-.4 1.8-1.3 1.9C11.5 20 4 12.5 4.7 5.1c.1-.9 1-1.5 1.9-1.3z" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  external: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" />,
}

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg className="rd-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

function Fact({ icon, children }: { icon: keyof typeof ICONS; children: ReactNode }) {
  return (
    <li className="rd-fact">
      <Icon name={icon} />
      <span>{children}</span>
    </li>
  )
}

/** Compact facts panel, always open. Only confirmed facts; no invented session times. */
export function RetreatDetails({ retreat, organiser }: { retreat: RetreatFacts; organiser?: { name: string; websiteUrl: string | null; retreatsPath?: string; interestAnchor?: string } }) {
  const website = retreat.retreatPageUrl || organiser?.websiteUrl || null
  const itinerary = retreat.itineraryUrl && retreat.itineraryUrl !== website ? retreat.itineraryUrl : null
  const dates = retreat.kind === 'itinerary' ? formatRange(retreat.startDate, retreat.endDate) : ''
  const place = retreat.propertyAddress || retreat.locationSummary
  const actions: Array<{ icon: keyof typeof ICONS; label: string; title?: string; href?: string; to?: string; external?: boolean }> = []
  if (retreat.contact?.email) actions.push({ icon: 'mail', label: 'Email', title: `Email ${retreat.contact.email}`, href: `mailto:${retreat.contact.email}` })
  // The number itself: readable on a computer, and a tap to call on a phone.
  if (retreat.contact?.phone) actions.push({ icon: 'phone', label: retreat.contact.phone, title: `Call ${retreat.contact.phone}`, href: `tel:${retreat.contact.phone.replace(/\s+/g, '')}` })
  if (organiser?.retreatsPath) actions.push({ icon: 'grid', label: 'More retreats', title: `More retreats by ${organiser.name}`, to: organiser.retreatsPath })
  if (organiser?.interestAnchor) actions.push({ icon: 'bell', label: 'Get updates', title: 'Hear about the next retreat', href: organiser.interestAnchor })

  return (
    <section className="details-card rd" aria-label={retreat.kind === 'property' ? 'About the property' : 'Retreat details'}>
      <span className="eyebrow">{retreat.kind === 'property' ? 'About the property' : 'Retreat details'}</span>
      <h2 className="rd-title">{retreat.title}</h2>

      <ul className="rd-facts">
        {dates && <Fact icon="calendar">{dates}</Fact>}
        {place && <Fact icon="pin">{place}</Fact>}
        {retreat.organiserName && <Fact icon="user">{retreat.organiserName}</Fact>}
      </ul>

      {retreat.amenities.length > 0 && (
        <ul className="rd-tags" aria-label="Highlights">
          {retreat.amenities.map((a) => (
            <li key={a} className="badge">
              {a}
            </li>
          ))}
        </ul>
      )}
      {retreat.routeSummary.length > 0 && (
        <ol className="rd-route muted small">
          {retreat.routeSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}

      {(website || itinerary) && (
        <div className="rd-links">
          {website && (
            <a className="btn rd-btn" href={website} rel="noopener noreferrer" target="_blank">
              <Icon name="globe" />
              Website
              <Icon name="external" size={15} />
            </a>
          )}
          {itinerary && (
            <a className="btn secondary rd-btn" href={itinerary} rel="noopener noreferrer" target="_blank">
              <Icon name="route" />
              {retreat.kind === 'property' ? 'Rooms' : 'Itinerary'}
            </a>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <ul className="rd-actions">
          {actions.map((a) => (
            <li key={a.label}>
              {a.to ? (
                <Link to={a.to} title={a.title} aria-label={a.title}>
                  <Icon name={a.icon} />
                  <span>{a.label}</span>
                </Link>
              ) : (
                <a href={a.href} title={a.title} aria-label={a.title}>
                  <Icon name={a.icon} />
                  <span>{a.label}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
