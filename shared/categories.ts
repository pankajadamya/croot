/** Default private-feedback categories. Each retreat stores its own copy and can edit it. */
export interface FeedbackCategory {
  key: string
  label: string
}

export const DEFAULT_FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  { key: 'yoga', label: 'Yoga instruction and pace' },
  { key: 'pilates', label: 'Pilates instruction and pace' },
  { key: 'meditation', label: 'Meditation and mindfulness' },
  { key: 'accommodation', label: 'Accommodation and comfort' },
  { key: 'meals', label: 'Meals, dietary care, and snacks' },
  { key: 'travel', label: 'Travel, transfers, and timing' },
  { key: 'excursions', label: 'Cultural visits and excursions' },
  { key: 'communication', label: 'Communication before and during the retreat' },
  { key: 'atmosphere', label: 'Group atmosphere and personal support' },
  { key: 'value', label: 'Overall value' },
]

/** Defaults for a retreat property: guests reviewing their own stay at a venue. */
export const PROPERTY_FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  { key: 'arrival', label: 'Booking, arrival and check-in' },
  { key: 'room', label: 'Room comfort and sleep' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'food', label: 'Food, dietary care and dining' },
  { key: 'classes', label: 'Classes, treatments and activities' },
  { key: 'facilities', label: 'Facilities and grounds' },
  { key: 'staff', label: 'Staff warmth and helpfulness' },
  { key: 'peace', label: 'Calm, quiet and atmosphere' },
  { key: 'communication', label: 'Communication before and during your stay' },
  { key: 'value', label: 'Overall value' },
]

export type ReviewKind = 'itinerary' | 'property'

export const REVIEW_KINDS: Record<ReviewKind, { label: string; short: string; description: string }> = {
  itinerary: {
    label: 'Itinerary retreat',
    short: 'Retreat',
    description: 'A hosted journey with fixed dates and a route, reviewed by the group who travelled together.',
  },
  property: {
    label: 'Retreat property',
    short: 'Property',
    description: 'A retreat venue reviewed by guests after their own stays, throughout the year.',
  },
}

export function defaultCategoriesFor(kind: ReviewKind): FeedbackCategory[] {
  return kind === 'property' ? PROPERTY_FEEDBACK_CATEGORIES : DEFAULT_FEEDBACK_CATEGORIES
}

/** Verbal anchors for the five-point scale. Meaning never depends on colour alone. */
export const SCALE_LABELS: Record<number, string> = {
  1: 'Needs improvement',
  2: 'Fair',
  3: 'Good',
  4: 'Very good',
  5: 'Excellent',
}

export const STORY_PROMPTS = [
  'What moment has stayed with you?',
  'How did the movement, setting, or group shape your experience?',
  'What would someone considering a future retreat want to know?',
]

export const PROPERTY_STORY_PROMPTS = [
  'What made your stay feel restorative?',
  'Which spaces, meals, classes or people stood out?',
  'Who would you recommend this place to, and when should they come?',
]

export function storyPromptsFor(kind: ReviewKind): string[] {
  return kind === 'property' ? PROPERTY_STORY_PROMPTS : STORY_PROMPTS
}

/** Bump whenever consent wording shown to guests changes; each ConsentEvent records it. */
// v2: group-album photo sharing now reaches anyone with the album's share link, not only fellow reviewers.
// v3: publishing the story includes its title and the guest's overall star rating.
// v6: album photos appear once the organiser approves them; the album is linked from the public retreat page.
// v7: adding a photo on the review form explicitly shares it with the story and available retreat album.
// v8: adding a photo shares it in the retreat album only; using photos on the organiser's website and social
//     media is a separate, explicit Yes/No answer (nothing pre-selected). Story reuse no longer mentions photos.
export const CONSENT_WORDING_VERSION = '2026-11-v8'

export const CONSENT_WORDING = {
  publicText: 'You may publish my written story, with its title and my overall star rating, on the retreat review site.',
  albumPhoto: 'Shared in the retreat’s photo album once the organiser approves it. The album is linked from the public retreat page, so anyone can see it, no sign-in needed. The organiser can take it out at any time, and you can stop sharing whenever you like.',
  firstName: 'You may show my first name with my story.',
  followUp: 'You may contact me about my private feedback.',
  marketing: 'You may reuse my story in social media or advertising (separate from the website).',
  photoMarketing:
    'You may use my photos to promote your retreats: with my story on the retreat review page (if I publish it), on your website and in social media or advertising. You can withdraw this at any time.',
  albumAdd:
    'Photos you add go into the retreat’s photo album once the organiser approves them, for everyone from the retreat to see. The album is linked from the public retreat page. You can remove any photo later.',
  photo: 'You may publish this photo with my story.',
}

/** A category the organiser removed: its ratings are kept but hidden; the name labels guests' data exports. */
export interface RemovedFeedbackCategory extends FeedbackCategory {
  removedAt: string
}

/**
 * The categories after an edit, and the removed ones to remember. A category missing from `requested`
 * was removed; one whose key belonged to a removed category is refused, so adding a category never
 * brings back old ratings (the editor picks fresh keys, so this only stops a stale or crafted request).
 */
export function reconcileCategories(
  previous: FeedbackCategory[],
  removedBefore: RemovedFeedbackCategory[],
  requested: FeedbackCategory[],
  now = new Date(),
): { removed: RemovedFeedbackCategory[]; reusedKey: string | null } {
  const kept = new Set(requested.map((c) => c.key))
  const previousKeys = new Set(previous.map((c) => c.key))
  const removed = new Map(removedBefore.map((c) => [c.key, c]))
  const reused = requested.find((c) => !previousKeys.has(c.key) && removed.has(c.key))
  for (const c of previous) {
    if (!kept.has(c.key)) removed.set(c.key, { key: c.key, label: c.label, removedAt: now.toISOString() })
  }
  return { removed: [...removed.values()], reusedKey: reused?.key ?? null }
}
