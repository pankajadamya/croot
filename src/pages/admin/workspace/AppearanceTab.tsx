import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, orgApi, post, put } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { checkThemeContrast, DEFAULT_THEME, isHexColour, THEME_TOKEN_KEYS, type ThemePreset, type ThemeTokenKey, type ThemeTokens } from '../../../../shared/themes'
import { ErrorNotice, Loading } from '../../../components/States'
import { ThemeScope } from '../../../components/ThemeScope'
import { MutationError } from '../adminUi'
import type { Retreat, ThemeRevision } from '../types'

interface ThemeState {
  presets: ThemePreset[]
  draft: ThemeRevision | null
  published: ThemeRevision | null
  fallback: ThemePreset
}

const themeKey = (orgSlug: string, retreatId: string) => ['admin', orgSlug, 'theme', retreatId]

function fetchTheme(orgSlug: string, retreatId: string) {
  return get<ThemeState>(`${orgApi(orgSlug)}/retreats/${retreatId}/theme`)
}

/** The theme an organiser is working on: draft, else published, else the default. */
export function useRetreatTheme(orgSlug: string, retreatId: string): { tokens: ThemeTokens; source: string } {
  const q = useQuery({ queryKey: themeKey(orgSlug, retreatId), queryFn: () => fetchTheme(orgSlug, retreatId) })
  const d = q.data
  if (d?.draft) return { tokens: d.draft.tokens, source: 'draft' }
  if (d?.published) return { tokens: d.published.tokens, source: 'published' }
  return { tokens: d?.fallback.tokens ?? DEFAULT_THEME.tokens, source: 'default' }
}


const TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  background: 'Page background',
  surface: 'Cards and panels',
  text: 'Body text',
  mutedText: 'Secondary text',
  accent: 'Accent and links',
  button: 'Button and focus ring',
  buttonText: 'Button text',
  border: 'Borders',
  overlay: 'Image overlay',
  overlayText: 'Text on image overlay',
}

export function AppearanceTab({ orgSlug, retreat }: { orgSlug: string; retreat: Retreat }) {
  const q = useQuery({ queryKey: themeKey(orgSlug, retreat.id), queryFn: () => fetchTheme(orgSlug, retreat.id) })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorNotice error={q.error} />
  if (!q.data) return null
  return <ThemeStudio key={q.data.draft?.id ?? 'none'} orgSlug={orgSlug} retreat={retreat} state={q.data} />
}

function ThemeStudio({ orgSlug, retreat, state }: { orgSlug: string; retreat: Retreat; state: ThemeState }) {
  const queryClient = useQueryClient()
  const start = state.draft ?? state.published
  const [presetKey, setPresetKey] = useState(start?.presetKey ?? state.fallback.key)
  const [name, setName] = useState(start?.name ?? state.fallback.name)
  const [tokens, setTokens] = useState<Record<ThemeTokenKey, string>>({ ...(start?.tokens ?? state.fallback.tokens) })
  const [message, setMessage] = useState<string | null>(null)

  const allValid = THEME_TOKEN_KEYS.every((k) => isHexColour(tokens[k]))
  const safeTokens = Object.fromEntries(THEME_TOKEN_KEYS.map((k) => [k, isHexColour(tokens[k]) ? tokens[k] : state.fallback.tokens[k]])) as ThemeTokens
  const checks = allValid ? checkThemeContrast(tokens as ThemeTokens) : []
  const failing = checks.filter((c) => !c.passes).length
  const canSave = allValid && failing === 0

  const base = `${orgApi(orgSlug)}/retreats/${retreat.id}/theme`
  const body = () => ({ name: name.trim() || 'Custom', presetKey, tokens })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: themeKey(orgSlug, retreat.id) })
  const save = useMutation({
    mutationFn: () => put(base, body()),
    onSuccess: () => {
      setMessage('Draft saved. Visitors still see the published theme.')
      void invalidate()
    },
  })
  const publish = useMutation({
    mutationFn: async () => {
      await put(base, body())
      await post(`${base}/publish`)
    },
    onSuccess: () => {
      setMessage('Theme published. Visitors see the new colours from their next page load.')
      void invalidate()
    },
  })

  function applyPreset(p: ThemePreset) {
    setPresetKey(p.key)
    setName(p.name)
    setTokens({ ...p.tokens })
    setMessage(null)
  }

  const isPresetUnchanged = state.presets.some((p) => p.key === presetKey && THEME_TOKEN_KEYS.every((k) => p.tokens[k].toLowerCase() === tokens[k].toLowerCase()))

  return (
    <div className="stack">
      <section className="card" aria-labelledby="th-presets">
        <div className="spread">
          <h2 id="th-presets" style={{ margin: 0 }}>
            Theme studio
          </h2>
          <span className="small muted">
            {state.published ? `Published: ${state.published.name}, ${formatDateTime(state.published.createdAt)}` : 'No theme published yet — the default is used.'}
          </span>
        </div>
        <p className="small muted">
          Colours apply to the public review site only. The guest’s writing form keeps its own calm theme so a change never interrupts someone mid-response.
        </p>
        <div className="row" role="group" aria-label="Starter themes">
          {state.presets.map((p) => (
            <button key={p.key} type="button" className="preset-btn" aria-pressed={presetKey === p.key && isPresetUnchanged} onClick={() => applyPreset(p)}>
              <span className="preset-swatches" aria-hidden="true">
                {(['background', 'text', 'accent', 'button'] as const).map((k) => (
                  <span key={k} style={{ background: p.tokens[k] }} />
                ))}
              </span>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card" aria-labelledby="th-colours">
          <h2 id="th-colours">Colours</h2>
          <div className="field">
            <label htmlFor="th-name">Theme name</label>
            <input id="th-name" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="token-grid">
            {THEME_TOKEN_KEYS.map((k) => {
              const valid = isHexColour(tokens[k])
              return (
                <div className="field" key={k} style={{ marginBottom: 0 }}>
                  <label htmlFor={`tok-${k}`}>{TOKEN_LABELS[k]}</label>
                  <div className="colour-input">
                    <input
                      type="color"
                      aria-label={`${TOKEN_LABELS[k]} colour picker`}
                      value={valid ? tokens[k].toLowerCase() : '#000000'}
                      onChange={(e) => {
                        setMessage(null)
                        setTokens((t) => ({ ...t, [k]: e.target.value.toUpperCase() }))
                      }}
                    />
                    <input
                      id={`tok-${k}`}
                      type="text"
                      value={tokens[k]}
                      aria-invalid={!valid}
                      spellCheck={false}
                      onChange={(e) => {
                        setMessage(null)
                        setTokens((t) => ({ ...t, [k]: e.target.value.trim() }))
                      }}
                    />
                  </div>
                  {!valid && (
                    <span className="error" role="alert">
                      Use a colour like #1E2D3A
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="card" aria-labelledby="th-contrast">
          <h2 id="th-contrast">Legibility checks</h2>
          {!allValid ? (
            <p className="muted">Fix the colour values to run the checks.</p>
          ) : (
            <>
              <p className={`notice ${failing ? 'error' : 'ok'}`} role="status">
                {failing ? `${failing} ${failing === 1 ? 'check fails' : 'checks fail'}. Adjust the colours before saving.` : 'All checks pass (WCAG AA).'}
              </p>
              <ul className="contrast-list">
                {checks.map((c) => (
                  <li key={c.label} className="spread">
                    <span>
                      <span className="contrast-sample" style={{ color: tokens[c.foreground], background: tokens[c.background] }} aria-hidden="true">
                        Aa
                      </span>{' '}
                      {c.label}
                    </span>
                    <span className={`badge ${c.passes ? 'ok' : 'danger'}`}>
                      {c.passes ? 'Pass' : 'Fail'} · {c.ratio}:1 (needs {c.minimum}:1)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section aria-labelledby="th-preview">
        <h2 id="th-preview">Preview</h2>
        <div className="theme-previews">
          <div>
            <p className="eyebrow">Desktop</p>
            <SitePreview tokens={safeTokens} title={retreat.title} />
          </div>
          <div>
            <p className="eyebrow">Mobile</p>
            <SitePreview tokens={safeTokens} title={retreat.title} mobile />
          </div>
        </div>
      </section>

      <div className="card tight spread" style={{ position: 'sticky', bottom: '1rem' }}>
        <div aria-live="polite" className="small">
          {message}
        </div>
        <div className="row">
          <button type="button" className="btn secondary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" className="btn" disabled={!canSave || publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? 'Publishing…' : 'Publish theme'}
          </button>
        </div>
      </div>
      <MutationError error={save.error || publish.error} />
    </div>
  )
}

function SitePreview({ tokens, title, mobile = false }: { tokens: ThemeTokens; title: string; mobile?: boolean }) {
  return (
    <ThemeScope tokens={tokens} className={`site theme-preview${mobile ? ' mobile' : ''}`}>
      <div className="tp-inner" aria-label={`${mobile ? 'Mobile' : 'Desktop'} preview`} role="img">
        <p className="eyebrow" style={{ margin: 0 }}>
          Guest stories
        </p>
        <h3 className="serif" style={{ fontSize: mobile ? '1.5rem' : '2rem', margin: 0 }}>
          {title}
        </h3>
        <p className="organiser-voice" style={{ margin: 0 }}>
          A few words from you set the scene before guests’ stories begin. <span style={{ color: 'var(--muted)' }}>Secondary text looks like this.</span>
        </p>
        <div className="row">
          <span className="btn">Read the stories</span>
          <span style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>Retreat details</span>
        </div>
        <div className="tp-overlay">
          <p className="serif" style={{ fontSize: '1.15rem', margin: 0 }}>
            “The mornings by the river are what I think of most.”
          </p>
          <p className="small" style={{ margin: '0.5rem 0 0' }}>
            — Guest story on an image
          </p>
        </div>
        <div className="card tight">
          <p style={{ margin: 0 }}>A story card on the surface colour.</p>
          <p className="small" style={{ margin: '0.25rem 0 0', color: 'var(--muted)' }}>
            Secondary text on a card
          </p>
        </div>
      </div>
    </ThemeScope>
  )
}
