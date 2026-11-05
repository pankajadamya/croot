import { describe, expect, it } from 'vitest'
import { autoExcerpt, isVerbatimExcerpt } from './excerpt.js'
import { THEME_PRESETS, validateTheme } from './themes.js'

describe('themes', () => {
  it('ships four presets that all pass contrast checks', () => {
    expect(THEME_PRESETS).toHaveLength(4)
    for (const p of THEME_PRESETS) expect(validateTheme(p.tokens), p.name).toEqual({ ok: true, errors: [] })
  })

  it('rejects illegible combinations', () => {
    const bad = { ...THEME_PRESETS[0].tokens, text: '#EEEEEE' }
    expect(validateTheme(bad).ok).toBe(false)
  })
})

describe('excerpts', () => {
  it('are always verbatim substrings of the story', () => {
    const story = 'First sentence here. Second one is a little longer than the first! Third. '.repeat(6)
    const e = autoExcerpt(story, 120)
    expect(e.length).toBeLessThanOrEqual(120)
    expect(isVerbatimExcerpt(story, e)).toBe(true)
  })
})
