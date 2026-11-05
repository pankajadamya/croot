/** Croot logo colourways. The public SVG assets use the same values. */
export const BRAND_PALETTES = {
  'forest-linen': { label: 'Forest and Linen', tile: '#FFFFFF', mark: '#183D3B', line: '#F8F5EF', accent: '#B47B62', word: '#183D3B', preview: '#F8F5EF' },
  'saffron-dusk': { label: 'Saffron Dusk', tile: '#FFFDF9', mark: '#3B2416', line: '#FFFDF9', accent: '#C56A36', word: '#3B2416', preview: '#FBF3E8' },
  'mountain-mist': { label: 'Mountain Mist', tile: '#FFFFFF', mark: '#1E2D3A', line: '#FFFFFF', accent: '#6A9AB4', word: '#1E2D3A', preview: '#EEF2F4' },
  'midnight-gold': { label: 'Midnight Gold', tile: '#1E222D', mark: '#D8B26A', line: '#14171F', accent: '#F3EEE2', word: '#F3EEE2', preview: '#14171F' },
  'plum-lilac': { label: 'Original Plum', tile: '#F3EDF4', mark: '#4C3558', line: '#E8D9E8', accent: '#A16E9A', word: '#4C3558', preview: '#F3EDF4' },
} as const

export type BrandPaletteKey = keyof typeof BRAND_PALETTES
export const BRAND_PALETTE_KEYS = Object.keys(BRAND_PALETTES) as BrandPaletteKey[]

export function isBrandPaletteKey(value: string): value is BrandPaletteKey {
  return Object.prototype.hasOwnProperty.call(BRAND_PALETTES, value)
}

export function brandAsset(kind: 'mark' | 'logo', palette: BrandPaletteKey): string {
  return `/brand/croot-${kind}-${palette}.svg`
}
