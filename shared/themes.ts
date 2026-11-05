/**
 * Public-site themes are named colour tokens (never arbitrary CSS), validated for WCAG contrast
 * before they can be saved or published. Shared by server (validation) and client (preview).
 */

export const THEME_TOKEN_KEYS = [
  'background',
  'surface',
  'text',
  'mutedText',
  'accent',
  'button',
  'buttonText',
  'border',
  'overlay',
  'overlayText',
] as const

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number]
export type ThemeTokens = Record<ThemeTokenKey, string>

export interface ThemePreset {
  key: string
  name: string
  tokens: ThemeTokens
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    key: 'forest-linen',
    name: 'Forest & Linen',
    tokens: {
      background: '#F8F5EF',
      surface: '#FFFFFF',
      text: '#183D3B',
      mutedText: '#4A5F5A',
      accent: '#8E5A43',
      button: '#183D3B',
      buttonText: '#F8F5EF',
      border: '#D9DED6',
      overlay: '#183D3B',
      overlayText: '#F8F5EF',
    },
  },
  {
    key: 'saffron-dusk',
    name: 'Saffron Dusk',
    tokens: {
      background: '#FBF3E8',
      surface: '#FFFDF9',
      text: '#3B2416',
      mutedText: '#6B4E3C',
      accent: '#9A4A12',
      button: '#9A4A12',
      buttonText: '#FFFDF9',
      border: '#EAD8C3',
      overlay: '#3B2416',
      overlayText: '#FFFDF9',
    },
  },
  {
    key: 'mountain-mist',
    name: 'Mountain Mist',
    tokens: {
      background: '#EEF2F4',
      surface: '#FFFFFF',
      text: '#1E2D3A',
      mutedText: '#4B5B68',
      accent: '#36627F',
      button: '#2C4F68',
      buttonText: '#FFFFFF',
      border: '#CCD6DD',
      overlay: '#1E2D3A',
      overlayText: '#FFFFFF',
    },
  },
  {
    key: 'midnight-gold',
    name: 'Midnight Gold',
    tokens: {
      background: '#14171F',
      surface: '#1E222D',
      text: '#F3EEE2',
      mutedText: '#C4BCA8',
      accent: '#D8B26A',
      button: '#D8B26A',
      buttonText: '#14171F',
      border: '#353A47',
      overlay: '#0B0D12',
      overlayText: '#F3EEE2',
    },
  },
]

export const DEFAULT_THEME = THEME_PRESETS[0]

const HEX = /^#[0-9a-fA-F]{6}$/

export function isHexColour(value: string): boolean {
  return HEX.test(value)
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export interface ContrastCheck {
  label: string
  foreground: ThemeTokenKey
  background: ThemeTokenKey
  minimum: number
  ratio: number
  passes: boolean
}

/** Every editable combination that carries text or a control, with its WCAG AA target. */
const CHECKS: Array<Omit<ContrastCheck, 'ratio' | 'passes'>> = [
  { label: 'Body text on page', foreground: 'text', background: 'background', minimum: 4.5 },
  { label: 'Body text on cards', foreground: 'text', background: 'surface', minimum: 4.5 },
  { label: 'Muted text on page', foreground: 'mutedText', background: 'background', minimum: 4.5 },
  { label: 'Muted text on cards', foreground: 'mutedText', background: 'surface', minimum: 4.5 },
  { label: 'Button label', foreground: 'buttonText', background: 'button', minimum: 4.5 },
  { label: 'Accent links on page', foreground: 'accent', background: 'background', minimum: 4.5 },
  { label: 'Button and focus ring against page', foreground: 'button', background: 'background', minimum: 3 },
  { label: 'Text on image overlay and story showcase', foreground: 'overlayText', background: 'overlay', minimum: 4.5 },
]

export function checkThemeContrast(tokens: ThemeTokens): ContrastCheck[] {
  return CHECKS.map((c) => {
    const ratio = contrastRatio(tokens[c.foreground], tokens[c.background])
    return { ...c, ratio: Math.round(ratio * 100) / 100, passes: ratio >= c.minimum }
  })
}

export function validateTheme(tokens: Partial<Record<string, unknown>>): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  for (const key of THEME_TOKEN_KEYS) {
    const v = tokens[key]
    if (typeof v !== 'string' || !isHexColour(v)) errors.push(`${key} must be a #RRGGBB colour`)
  }
  if (errors.length) return { ok: false, errors }
  for (const c of checkThemeContrast(tokens as ThemeTokens)) {
    if (!c.passes) errors.push(`${c.label}: contrast ${c.ratio}:1 is below ${c.minimum}:1`)
  }
  return { ok: errors.length === 0, errors }
}
