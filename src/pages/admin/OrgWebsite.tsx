import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, orgApi, patch } from '../../lib/api'
import { Field } from '../../components/Controls'
import { MutationError } from './adminUi'

/** The organisation's own website, linked from its public retreat pages. Saves when the field loses focus. */
export function OrgWebsite({ orgSlug, canEdit }: { orgSlug: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const key = ['admin', orgSlug, 'profile']
  const q = useQuery({ queryKey: key, queryFn: () => get<{ name: string; websiteUrl: string | null }>(`${orgApi(orgSlug)}/profile`) })
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => {
    if (q.data) setUrl(q.data.websiteUrl ?? '')
  }, [q.data])
  const save = useMutation({
    mutationFn: (websiteUrl: string) => patch(`${orgApi(orgSlug)}/profile`, { websiteUrl }),
    onSuccess: () => {
      setSaved('Saved')
      void qc.invalidateQueries({ queryKey: key })
    },
  })
  if (!q.data) return null
  if (!canEdit) {
    return (
      <p className="small muted" style={{ marginBottom: '1.5rem' }}>
        Website: {q.data.websiteUrl ? <a href={q.data.websiteUrl} target="_blank" rel="noopener noreferrer">{q.data.websiteUrl}</a> : 'not set'} · the
        organisation’s owner can change it.
      </p>
    )
  }
  return (
    <div className="card tight" style={{ marginBottom: '1.5rem' }}>
      <Field
        id="org-website"
        label="Your website"
        hint="Linked from the top of every public retreat page, so visitors can find you. Leave empty to hide it."
      >
        <input
          id="org-website"
          type="url"
          placeholder="https://"
          value={url}
          disabled={!canEdit}
          onChange={(e) => {
            setUrl(e.target.value)
            setSaved(null)
          }}
          onBlur={() => url.trim() !== (q.data.websiteUrl ?? '') && save.mutate(url.trim())}
        />
      </Field>
      <span className="small muted" aria-live="polite">
        {save.isPending ? 'Saving…' : saved}
        {!canEdit && 'Only the organisation’s owner can change this.'}
      </span>
      <MutationError error={save.error} />
    </div>
  )
}
