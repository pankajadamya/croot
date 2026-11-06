/**
 * Versions of the platform's legal texts. Bump a version whenever its wording changes so the
 * acceptance recorded against an organisation (dpaVersion) or request (termsVersion) stays meaningful.
 * The texts are in src/pages/public/Legal.tsx and the generated tenant notice (PrivacyNotice.tsx).
 */
export const PLATFORM_PRIVACY_VERSION = '2026-11-4'
export const PROCESSING_TERMS_VERSION = '2026-11-2'
/** Shown as "Last updated" on the platform's legal pages. */
export const LEGAL_LAST_UPDATED = '6 November 2026'

/**
 * Who operates Croot (controller for organiser accounts, processor for guest data). A sole trader,
 * so trading disclosures are the name and an address for service; no company number.
 */
export const PLATFORM_OPERATOR = {
  name: 'Kamalesh Chaudhary (trading as Croot)',
  address: '2 Muscliffe Lane, Bournemouth BH9 3NL, United Kingdom',
  email: 'kamuchahar@gmail.com',
  hosting: 'OVHcloud: servers in London, United Kingdom, and photo storage in Paris, France',
  email_delivery: 'Amazon Web Services (Amazon Simple Email Service), in Ireland',
  sign_in: 'Google, only if you choose to sign in with Google',
}

/** Bounds for the retention settings an organisation can choose. */
export const RETENTION_LIMITS = {
  draftRetentionDays: { min: 7, max: 365, label: 'Unsent drafts', unit: 'days' },
  nonResponderRetentionDays: { min: 30, max: 730, label: 'Guests who never respond', unit: 'days' },
  responseRetentionMonths: { min: 3, max: 84, label: 'Private feedback and unpublished responses', unit: 'months' },
  anonymousNoteRetentionMonths: { min: 1, max: 84, label: 'Anonymous notes', unit: 'months' },
  auditRetentionMonths: { min: 12, max: 120, label: 'Audit log', unit: 'months' },
} as const

export type RetentionKey = keyof typeof RETENTION_LIMITS
export type RetentionSettings = Record<RetentionKey, number>
