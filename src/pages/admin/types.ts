import type { FeedbackCategory, ReviewKind } from '../../../shared/categories'
import type { ThemeTokens } from '../../../shared/themes'

export type RetreatStatus = 'draft' | 'collecting' | 'closed' | 'archived'

export interface Retreat {
  id: string
  organisationId: string
  slug: string
  kind: ReviewKind
  title: string
  startDate: string | null
  endDate: string | null
  locationSummary: string
  propertyAddress: string | null
  amenities: string[]
  routeSummary: string[]
  itineraryUrl: string | null
  retreatPageUrl: string | null
  organiserName: string
  contactEmail: string | null
  contactPhone: string | null
  contactPublic: boolean
  privacyUrl: string | null
  status: RetreatStatus
  inviteOpensAt: string | null
  inviteClosesAt: string | null
  inviteTtlDays: number
  draftEditingEnabled: boolean
  publicReviewsEnabled: boolean
  writingSlideshowEnabled: boolean
  heroSlideshowEnabled: boolean
  showPublicRating: boolean
  rewardAlbumEnabled: boolean
  rewardAlbumUrl: string | null
  rewardAlbumNote: string
  rewardAlbumCoverId: string | null
  feedbackCategories: FeedbackCategory[]
  aggregateThreshold: number
  createdAt: string
  updatedAt: string
}

export interface RetreatStats {
  attendees: number
  opened: number
  drafts: number
  submitted: number
  published: number
  anonymousNotes: number
}

export interface RetreatSummary {
  id: string
  slug: string
  kind: ReviewKind
  title: string
  status: RetreatStatus
  startDate: string | null
  endDate: string | null
  stats: RetreatStats
}

export interface OrgSummary {
  org: { id: string; slug: string; name: string; status: 'active' | 'suspended'; role: 'owner' | 'organiser' | 'platform' }
  openChangeRequests: number
  retreats: RetreatSummary[]
}

export type InviteState =
  | 'not_invited'
  | 'revoked'
  | 'expired'
  | 'sent'
  | 'opened'
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'consented'
  | 'published'
  | 'withdrawn'

export interface AttendeeRowView {
  id: string
  name: string
  email: string
  state: InviteState
  stayStart?: string | null
  stayEnd?: string | null
  responseId: string | null
  invitation: { hint: string; issuedAt: string; expiresAt: string; openedAt: string | null; lastUsedAt: string | null; revoked: boolean; emailedAt?: string | null } | null
}

export interface CsvPreviewRow {
  line: number
  name: string
  email: string
  stayStart?: string | null
  stayEnd?: string | null
  status: 'ok' | 'invalid' | 'duplicate_in_file' | 'already_imported'
  problem?: string
}

export type ResponseStatus = 'submitted' | 'changes_requested' | 'withdrawn'
export type PublicationStatus = 'none' | 'published' | 'unpublished' | 'withdrawn'

export interface ResponseListItem {
  id: string
  attendeeName: string
  status: ResponseStatus
  publicationStatus: PublicationStatus
  submittedAt: string | null
  hasStory: boolean
  storyPreview: string
  consentPublicText: boolean
  consentFirstName: boolean
  photoCount: number
  openChangeRequests: number
  pinned: boolean
  updatedSincePublished?: boolean
}

export interface ResponseDetailData {
  id: string
  retreat: { id: string; title: string; slug: string }
  attendee: { name: string; email: string | null; stay: { start: string | null; end: string | null } | null }
  status: ResponseStatus
  submittedAt: string | null
  organiserMessage: string | null
  publicStory: { title: string; text: string; submittedText: string | null; overallRating: number | null; suggestedExcerpt: string }
  privateFeedback: {
    ratings: Array<{ key: string; label: string; score: number | null; notApplicable: boolean; comment: string }>
    keepText: string | null
    changeText: string | null
    followUpOk: boolean
  }
  consents: {
    publicText: boolean
    firstName: boolean
    followUp: boolean
    marketing: boolean
    wordingVersion: string | null
    history: Array<{ scope: string; granted: boolean; actor: string; wordingVersion: string | null; at: string }>
  }
  photos: Array<{
    id: string
    previewUrl: string
    altText: string
    caption: string
    publishConsent: boolean
    moderation: 'pending' | 'approved' | 'rejected'
    live: boolean
  }>
  publication: {
    status: PublicationStatus
    publicSlug: string | null
    pinned: boolean
    live: { excerpt: string; displayName: string | null; photoIds: string[]; at: string } | null
    history: Array<{ status: string; reason: string | null; at: string; photoCount: number; excerpt: string }>
  }
  changeRequests: Array<{ id: string; kind: 'edit' | 'withdraw'; message: string; status: 'open' | 'resolved'; createdAt: string }>
}

export interface ContentRevision {
  id: string
  headline: string
  introParagraphs: string[]
  ctaLabel: string
  ctaUrl: string
  status: 'draft' | 'published' | 'archived'
  publishAt: string | null
  createdAt: string
}

export interface ThemeRevision {
  id: string
  name: string
  presetKey: string
  tokens: ThemeTokens
  status: 'draft' | 'published' | 'archived'
  createdAt: string
}

export interface OrganiserMedia {
  id: string
  previewUrl: string
  altText: string
  caption: string
  credit: string
  rightsConfirmed: boolean
  approved: boolean
  displayOrder: number
  focalX: number
  focalY: number
  inHeroSlideshow: boolean
  inWritingSlideshow: boolean
  kind?: 'organiser' | 'album' | 'guest'
  inAlbum?: boolean
  albumOrder?: number
  isVideo?: boolean
  videoUrl?: string | null
  durationSec?: number | null
}
