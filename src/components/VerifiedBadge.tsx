import { Link } from 'react-router'

/**
 * "Verified email" on a public review: the guest proved they own the address the review came from.
 * It links to how Croot verifies reviews, since a badge should say what it does (and doesn't) mean.
 */
export function VerifiedBadge() {
  return (
    <Link
      to="/legal/verification"
      className="review-badge is-verified"
      title="The guest proved they own the email address this review came from. Click to see how Croot verifies reviews."
    >
      <span aria-hidden="true">✓</span> Verified email
    </Link>
  )
}
