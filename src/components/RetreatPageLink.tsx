/** "See what others are saying": the retreat's public page (organiser's details and published reviews), in a new tab. */
export function RetreatPageLink({ href, title }: { href: string | null | undefined; title: string }) {
  if (!href) return null
  return (
    <div className="card tight retreat-page-link">
      <div>
        <h2 style={{ fontSize: '1.15rem', margin: 0 }}>See what others are saying</h2>
        <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
          Visit the {title} page: the organiser’s introduction and details, together with the reviews other guests have published.
        </p>
      </div>
      <a className="btn secondary" href={href} target="_blank" rel="noopener">
        Visit the retreat page ↗<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  )
}
