/**
 * Thin fetch wrapper. Admin requests carry the session's CSRF token in a header; attendee and
 * public requests never send cookies' worth of identity beyond what the browser attaches.
 */
let csrfToken: string | null = null

export function setCsrfToken(token: string | null) {
  csrfToken = token
}

export class ApiError extends Error {
  status: number
  details?: Record<string, string[] | undefined> & { conflict?: boolean; tokens?: string[] }
  constructor(status: number, message: string, details?: ApiError['details']) {
    super(message)
    this.status = status
    this.details = details
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function api<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  opts: { signal?: AbortSignal; credentials?: RequestCredentials } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (method !== 'GET' && csrfToken && path.startsWith('/api/')) headers['X-CSRF-Token'] = csrfToken
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: opts.credentials ?? 'same-origin', signal: opts.signal, referrerPolicy: 'no-referrer' })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'You appear to be offline. Your text is kept on this page; try again when you are connected.')
  }
  if (res.ok && changesAttention(method, path)) announceChange()
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong', data.details)
  return data as T
}

/** Fired after anything that can change what the notifications bell shows, so it refreshes at once. */
export const DATA_CHANGED_EVENT = 'croot:data-changed'
let pending: number | undefined
function announceChange() {
  // One refresh for a burst of changes (e.g. approving several photos).
  window.clearTimeout(pending)
  pending = window.setTimeout(() => window.dispatchEvent(new Event(DATA_CHANGED_EVENT)), 250)
}
function changesAttention(method: Method, path: string) {
  if (!/^\/api\/(admin|platform|account)\//.test(path)) return false
  // Opening anonymous notes marks them as seen.
  return method !== 'GET' || /\/anonymous(\?|$)/.test(path)
}

export const get = <T,>(path: string) => api<T>('GET', path)
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {})
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body)
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body)
export const del = <T,>(path: string) => api<T>('DELETE', path)

/** Prefix for organisation-scoped admin endpoints. */
export const orgApi = (orgSlug: string) => `/api/admin/orgs/${encodeURIComponent(orgSlug)}`
