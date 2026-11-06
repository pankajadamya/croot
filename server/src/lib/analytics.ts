import { env } from './env.js'

/**
 * Self-hosted, cookieless page statistics (Umami at analytics.snaprows.dev, shared with Collab and
 * MyAyurvedaTrip). Off unless UMAMI_WEBSITE_ID is set: then the server adds Umami's script to the
 * page and the Content-Security-Policy allows its origin; otherwise neither happens.
 *
 * The script's own tracking is off (data-auto-track="false"): it would send the real address, and
 * invite, receipt and album addresses carry tokens. src/lib/analytics.ts sends every page view
 * itself, with the address reduced to a route pattern.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface UmamiConfig {
  origin: string
  websiteId: string
}

export function umamiConfig(websiteId = env.UMAMI_WEBSITE_ID, origin = env.UMAMI_ORIGIN): UmamiConfig | null {
  const id = websiteId?.trim()
  if (!id || !UUID.test(id)) return null
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return { origin: url.origin, websiteId: id }
  } catch {
    return null
  }
}

/** The tag added before </head>. Respects the browser's Do Not Track setting. */
export function umamiScriptTag(config: UmamiConfig): string {
  return (
    `<script defer src="${config.origin}/script.js" data-website-id="${config.websiteId}" ` +
    `data-auto-track="false" data-exclude-search="true" data-exclude-hash="true" data-do-not-track="true"></script>`
  )
}

export function withUmami(html: string, config: UmamiConfig | null): string {
  return config ? html.replace('</head>', `  ${umamiScriptTag(config)}\n  </head>`) : html
}
