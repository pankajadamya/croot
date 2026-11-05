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

/** Compact, expandable facts panel. Only confirmed facts; no invented session times. */
export function RetreatDetails({ retreat, defaultOpen = false }: { retreat: RetreatFacts; defaultOpen?: boolean }) {
  return (
    <details className="details-card" open={defaultOpen}>
      <summary>
        <span>
          <span className="eyebrow" style={{ display: 'block' }}>
            {retreat.kind === 'property' ? 'About the property' : 'Retreat details'}
          </span>
          <span className="serif" style={{ fontSize: '1.2rem', fontWeight: 400 }}>
            {retreat.title}
          </span>
        </span>
        <span aria-hidden="true">＋</span>
      </summary>
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
        <div className="row">
          {retreat.itineraryUrl && (
            <a href={retreat.itineraryUrl} rel="noopener noreferrer" target="_blank">
              {retreat.kind === 'property' ? 'Rooms and programmes' : 'Full itinerary'}
            </a>
          )}
          {retreat.retreatPageUrl && retreat.retreatPageUrl !== retreat.itineraryUrl && (
            <a href={retreat.retreatPageUrl} rel="noopener noreferrer" target="_blank">
              {retreat.kind === 'property' ? 'Property website' : 'Retreat page'}
            </a>
          )}
          {retreat.contact?.email && <a href={`mailto:${retreat.contact.email}`}>Contact the organiser</a>}
          {retreat.contact?.phone && <a href={`tel:${retreat.contact.phone.replace(/\s+/g, '')}`}>{retreat.contact.phone}</a>}
        </div>
      </div>
    </details>
  )
}
