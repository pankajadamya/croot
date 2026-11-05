import { Link } from 'react-router'
import { ApiError } from '../lib/api'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" role="status" style={{ padding: '2rem 0' }}>
      {label}
    </p>
  )
}

export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="notice error" role="alert">
      {message}
    </div>
  )
}

export function NotFound() {
  return (
    <main className="calm">
      <div className="narrow" style={{ padding: '5rem 0' }}>
        <h1>Page not found</h1>
        <p className="muted">The page you were looking for isn’t here.</p>
        <Link to="/">Go to the home page</Link>
      </div>
    </main>
  )
}

/** Shown for invalid, expired or revoked links. Deliberately generic. */
export function LinkUnavailable({ message }: { message: string }) {
  return (
    <main className="calm">
      <div className="narrow stack" style={{ padding: '5rem 0' }}>
        <p className="eyebrow">Link unavailable</p>
        <h1>We couldn’t open this link</h1>
        <p>{message}</p>
        <p className="muted">
          If you’ve sent a review, you can always find it by signing in with the email address your invitation went to. Otherwise, ask the
          organiser for a new link.
        </p>
        <div className="row">
          <a className="btn" href={`/signin?next=${encodeURIComponent('/my-reviews')}`}>
            Sign in to see my reviews
          </a>
          <a className="btn ghost" href="/">
            Croot home
          </a>
        </div>
      </div>
    </main>
  )
}
