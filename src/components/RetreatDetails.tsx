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

/** Compact facts panel, always open. Only confirmed facts; no invented session times. */
export function RetreatDetails({ retreat }: { retreat: RetreatFacts }) {
  return (
    <section className="details-card" aria-label={retreat.kind === 'property' ? 'About the property' : 'Retreat details'}>
      <div>
        <span className="eyebrow" style={{ display: 'block' }}>
          {retreat.kind === 'property' ? 'About the property' : 'Retreat details'}
        </span>
        <span className="serif" style={{ fontSize: '1.2rem', fontWeight: 400 }}>
          {retreat.title}
        </span>
      </div>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p style={{ margin: 0 }}>
          {retreat.kind === 'itinerary' && <strong>{formatRange(retreat.startDate, retreat.endDate)}</strong>}
          {retreat.kind === 'itinerary' && retreat.locationSummary && ' · '}
          {retreat.locationSummary}
        </p>
        {retreat.propertyAddress && <p style={{ margin: 0 }} className="muted">{retreat.propertyAddress}</p>}
        {retreat.amenities.length > 0 && (
          <ul className="row muted small" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Highlights">
            {retreat.amenities.map((a) => (
              <li key={a} className="badge">
                {a}
              </li>
            ))}
          </ul>
        )}
        {retreat.routeSummary.length > 0 && (
          <ol className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {retreat.routeSummary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        )}
        {retreat.organiserName && <p style={{ margin: 0 }}>Organised by {retreat.organiserName}</p>}
        {/* The organiser's own site, when they've given one: shown as buttons so it's easy to find. */}
        {(retreat.retreatPageUrl || retreat.itineraryUrl) && (
          <div className="row">
            {retreat.retreatPageUrl && (
              <a className="btn" href={retreat.retreatPageUrl} rel="noopener noreferrer" target="_blank">
                {retreat.kind === 'property' ? 'Visit the property website' : 'Visit the retreat website'} ↗
              </a>
            )}
            {retreat.itineraryUrl && retreat.itineraryUrl !== retreat.retreatPageUrl && (
              <a className="btn secondary" href={retreat.itineraryUrl} rel="noopener noreferrer" target="_blank">
                {retreat.kind === 'property' ? 'Rooms and programmes' : 'Full itinerary'} ↗
              </a>
            )}
          </div>
        )}
        <div className="row">
          {retreat.contact?.email && <a href={`mailto:${retreat.contact.email}`}>Contact the organiser</a>}
          {retreat.contact?.phone && <a href={`tel:${retreat.contact.phone.replace(/\s+/g, '')}`}>{retreat.contact.phone}</a>}
        </div>
      </div>
    </section>
  )
}
