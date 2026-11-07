/**
 * "Who did you go with?" on a review. "On my own" is the default, so a guest who came alone has nothing
 * to do. A review stays one vote however many people it was written for; the public review only gets
 * a short label ("Travelled as a couple"), never who the companions were.
 */
export const TRAVELLED_WITH = [
  { id: 'solo', label: 'On my own' },
  { id: 'partner', label: 'With my partner' },
  { id: 'friends', label: 'With friends' },
  { id: 'family', label: 'With family' },
  { id: 'colleagues', label: 'With colleagues' },
] as const

export type TravelledWith = (typeof TRAVELLED_WITH)[number]['id']
export const TRAVELLED_WITH_IDS = TRAVELLED_WITH.map((t) => t.id) as [TravelledWith, ...TravelledWith[]]
export const MAX_PARTY_SIZE = 30

/**
 * The public label, e.g. "Travelled as a couple" or "Stayed with family · group of 4". None for "On my
 * own": it's the default, so it may simply not have been answered.
 */
export function companyLabel(kind: 'itinerary' | 'property', travelledWith: string, partySize: number): string | null {
  const verb = kind === 'property' ? 'Stayed' : 'Travelled'
  switch (travelledWith) {
    case 'partner':
      return `${verb} as a couple`
    case 'friends':
    case 'family':
    case 'colleagues':
      return `${verb} with ${travelledWith}${partySize >= 3 ? ` · group of ${partySize}` : ''}`
    default:
      return null
  }
}
