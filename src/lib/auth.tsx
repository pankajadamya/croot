import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, get, post, setCsrfToken } from './api'

export interface Membership {
  slug: string
  name: string
  status: 'active' | 'suspended'
  role: 'owner' | 'organiser'
}

export interface Session {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean }
  csrfToken: string
  memberships: Membership[]
}

interface AuthState {
  session: Session | null
  loading: boolean
  setSession: (s: Session | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const setSession = useCallback((s: Session | null) => {
    setCsrfToken(s?.csrfToken ?? null)
    setSessionState(s)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setSession(await get<Session>('/api/auth/me'))
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e)
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [setSession])

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {})
    setSession(null)
  }, [setSession])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return <AuthContext.Provider value={{ session, loading, setSession, refresh, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
