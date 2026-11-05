/**
 * Versions of the platform's legal texts. Bump a version whenever its wording changes so the
 * acceptance recorded against an organisation (dpaVersion) or request (termsVersion) stays meaningful.
 *
 * DRAFTS: the texts these versions refer to (src/pages/public/Legal.tsx and the generated tenant
 * notice) must be reviewed by a qualified privacy professional before production use.
 */
export const PLATFORM_PRIVACY_VERSION = '2026-11-draft-1'
export const PROCESSING_TERMS_VERSION = '2026-11-draft-1'

/**
 * The company operating croot (the processor). PLACEHOLDERS — fill in before launch.
 */
export const PLATFORM_OPERATOR = {
  name: '[Operator legal name — to confirm]',
  address: '[Registered address — to confirm]',
  email: 'privacy@croot.example',
  hosting: 'OVHcloud (servers and object storage) — confirm region and contract before launch',
}

/** Bounds for the retention settings an organisation can choose. */
export const RETENTION_LIMITS = {
  draftRetentionDays: { min: 7, max: 365, label: 'Unsent drafts', unit: 'days' },
  nonResponderRetentionDays: { min: 30, max: 730, label: 'Guests who never respond', unit: 'days' },
  responseRetentionMonths: { min: 3, max: 84, label: 'Private feedback and unpublished responses', unit: 'months' },
  originalPhotoRetentionDays: { min: 1, max: 365, label: 'Original photo uploads', unit: 'days' },
  anonymousNoteRetentionMonths: { min: 1, max: 84, label: 'Anonymous notes', unit: 'months' },
  auditRetentionMonths: { min: 12, max: 120, label: 'Audit log', unit: 'months' },
} as const

export type RetentionKey = keyof typeof RETENTION_LIMITS
export type RetentionSettings = Record<RetentionKey, number>
