import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Field } from '../../components/Controls'
import { ErrorNotice, Loading } from '../../components/States'
import { fieldError, MutationError } from '../admin/adminUi'

interface Settings {
  albumMaxPhotos: number
  albumMaxVideos: number
  updatedAt: string
}

const KEY = ['platform', 'settings']

/** Platform-wide limits, such as how many photos and videos an organiser can put in each album. */
export function PlatformSettings() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: () => get<{ settings: Settings }>('/api/platform/settings').then((r) => r.settings) })
  const [form, setForm] = useState({ albumMaxPhotos: '', albumMaxVideos: '' })
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (settings.data) setForm({ albumMaxPhotos: String(settings.data.albumMaxPhotos), albumMaxVideos: String(settings.data.albumMaxVideos) })
  }, [settings.data])
  const save = useMutation({
    mutationFn: () => patch('/api/platform/settings', { albumMaxPhotos: Number(form.albumMaxPhotos), albumMaxVideos: Number(form.albumMaxVideos) }),
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: KEY })
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    save.mutate()
  }
  const changed = settings.data && (form.albumMaxPhotos !== String(settings.data.albumMaxPhotos) || form.albumMaxVideos !== String(settings.data.albumMaxVideos))

  return (
    <section className="card" aria-labelledby="pf-settings">
      <h2 id="pf-settings">Limits</h2>
      <p className="small muted">
        How much an organiser can put in each retreat’s photo album. Guests’ own photos don’t count. Lowering a limit doesn’t remove anything
        already in an album; it only stops more being added.
      </p>
      {settings.isLoading && <Loading />}
      {settings.error && <ErrorNotice error={settings.error} />}
      {settings.data && (
        <form onSubmit={submit} noValidate style={{ maxWidth: 520 }}>
          <div className="grid-2">
            <Field id="pf-album-photos" label="Photos per album" error={fieldError(save.error, 'albumMaxPhotos')}>
              <input
                id="pf-album-photos"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                value={form.albumMaxPhotos}
                onChange={(e) => setForm((f) => ({ ...f, albumMaxPhotos: e.target.value }))}
              />
            </Field>
            <Field id="pf-album-videos" label="Videos per album" error={fieldError(save.error, 'albumMaxVideos')}>
              <input
                id="pf-album-videos"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={form.albumMaxVideos}
                onChange={(e) => setForm((f) => ({ ...f, albumMaxVideos: e.target.value }))}
              />
            </Field>
          </div>
          <MutationError error={save.error} shownFields={['albumMaxPhotos', 'albumMaxVideos']} />
          <div className="row">
            <button className="btn" type="submit" disabled={!changed || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save limits'}
            </button>
            <span className="small muted" role="status">
              {saved && !changed ? 'Saved' : `Last changed ${formatDateTime(settings.data.updatedAt)}`}
            </span>
          </div>
        </form>
      )}
    </section>
  )
}
