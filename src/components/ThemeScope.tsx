import type { CSSProperties, ReactNode } from 'react'
import type { ThemeTokens } from '../../shared/themes'

/** Maps validated theme tokens onto the CSS variables used by the public site. */
export function themeStyle(tokens: ThemeTokens): CSSProperties {
  return {
    '--bg': tokens.background,
    '--surface': tokens.surface,
    '--text': tokens.text,
    '--muted': tokens.mutedText,
    '--accent': tokens.accent,
    '--button': tokens.button,
    '--button-text': tokens.buttonText,
    '--border': tokens.border,
    '--overlay': tokens.overlay,
    '--overlay-text': tokens.overlayText,
    '--sage': `color-mix(in srgb, ${tokens.accent} 12%, ${tokens.surface})`,
  } as CSSProperties
}

export function ThemeScope({ tokens, children, className = 'site' }: { tokens: ThemeTokens; children: ReactNode; className?: string }) {
  return (
    <div className={className} style={themeStyle(tokens)}>
      {children}
    </div>
  )
}
