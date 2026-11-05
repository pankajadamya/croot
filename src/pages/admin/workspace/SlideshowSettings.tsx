import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orgApi, patch } from '../../../lib/api'
import { Switch } from '../../../components/Controls'
import { MutationError, retreatKey } from '../adminUi'
import type { OrganiserMedia, Retreat } from '../types'

/** What an organiser image still needs, or where it's showing. In words, never colour alone. */
export function imageStatus(m: OrganiserMedia): string {
  if (!m.rightsConfirmed) return 'Not shown: confirm you have permission'
  const where = [m.inHeroSlideshow && 'public slideshow', m.inWritingSlideshow && 'guest form'].filter(Boolean)
  return where.length ? `Showing in: ${where.join(', ')}` : 'Ready, but not in a slideshow'
}

/**
 * The programme's two slideshow switches, placed beside the images they show, with how many images are
 * ready. The same switches also appear in the programme's settings.
 */
export function SlideshowSettings({ orgSlug, retreat, media }: { orgSlug: string; retreat: Retreat; media: OrganiserMedia[] }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (body: Partial<Pick<Retreat, 'heroSlideshowEnabled' | 'writingSlideshowEnabled'>>) =>
      patch(`${orgApi(orgSlug)}/retreats/${retreat.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: retreatKey(orgSlug, retreat.id) }),
  })
  const ready = media.filter((m) => m.approved)
  const heroCount = ready.filter((m) => m.inHeroSlideshow).length
  const writingCount = ready.filter((m) => m.inWritingSlideshow).length
  const plural = (n: number) => `${n} image${n === 1 ? '' : 's'}`

  return (
    <div className="panel-sage" style={{ margin: '1rem 0' }}>
      <Switch
        checked={retreat.heroSlideshowEnabled}
        disabled={update.isPending}
        onChange={(v) => update.mutate({ heroSlideshowEnabled: v })}
        label="Show a photo slideshow on the public review page"
        description={retreat.heroSlideshowEnabled ? `Showing ${plural(heroCount)}.` : 'The public page has no slideshow.'}
      />
      <Switch
        checked={retreat.writingSlideshowEnabled}
        disabled={update.isPending}
        onChange={(v) => update.mutate({ writingSlideshowEnabled: v })}
        label="Show retreat photos beside the guest’s review form"
        description={
          retreat.writingSlideshowEnabled
            ? `Showing ${plural(writingCount)} beside the form. Guests can hide them.`
            : 'Guests see a plain panel beside the form.'
        }
      />
      <p className="small" style={{ margin: '0.6rem 0 0' }}>
        <strong>
          {ready.length} of {plural(media.length)} ready to show.
        </strong>{' '}
        {media.length > ready.length && 'An image shows once you’ve confirmed you have permission to use it.'}
      </p>
      <MutationError error={update.error} />
    </div>
  )
}
