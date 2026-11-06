import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orgApi, patch } from '../../../lib/api'
import { MutationError, retreatKey } from '../adminUi'
import type { OrganiserMedia, Retreat } from '../types'

/** The public slideshow shows at most this many photos (enforced by the server too). */
export const MAX_SLIDESHOW = 10

/** What an organiser image still needs, or where it's showing. In words, never colour alone. */
export function imageStatus(m: OrganiserMedia): string {
  if (!m.rightsConfirmed) return 'Not shown: confirm you have permission'
  return m.inHeroSlideshow ? 'Public slideshow and guest form' : 'Ready, but not in the slideshow'
}

/**
 * The programme's two slideshow switches, placed beside the images they show, with how many images are
 * ready. This is the only place they live.
 */
export function SlideshowSettings({ orgSlug, retreat, media }: { orgSlug: string; retreat: Retreat; media: OrganiserMedia[] }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (body: Partial<Pick<Retreat, 'heroSlideshowEnabled'>>) =>
      patch(`${orgApi(orgSlug)}/retreats/${retreat.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: retreatKey(orgSlug, retreat.id) }),
  })
  const ready = media.filter((m) => m.approved)
  const heroCount = ready.filter((m) => m.inHeroSlideshow).length

  return (
    <div className="site-showcase-status">
      <div>
        <strong>Public slideshow · {retreat.heroSlideshowEnabled ? 'On' : 'Off'}</strong>
        <p className="small muted">
          {heroCount} of {MAX_SLIDESHOW} selected{heroCount >= MAX_SLIDESHOW ? ' (full: take one out to add another)' : ''}. Selected photos always appear beside the guest review form.
        </p>
        {media.length > ready.length && <p className="small muted">{media.length - ready.length} older image(s) still need permission confirmation.</p>}
      </div>
      <button type="button" className="btn secondary small" disabled={update.isPending} onClick={() => update.mutate({ heroSlideshowEnabled: !retreat.heroSlideshowEnabled })}>
        {retreat.heroSlideshowEnabled ? 'Turn off public slideshow' : 'Turn on public slideshow'}
      </button>
      <MutationError error={update.error} />
    </div>
  )
}
