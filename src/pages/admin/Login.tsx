import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { post } from '../../lib/api'
import { useAuth, type Session } from '../../lib/auth'
import { Field } from '../../components/Controls'
import { Loading } from '../../components/States'
import { fieldError, MutationError } from './adminUi'

export default function Login() {
  const { session, loading, setSession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const target = from && from.startsWith('/') && !from.startsWith('//') ? from : '/admin'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => post<Session>('/api/auth/login', { email, password }),
    onSuccess: (s) => {
      setSession(s)
      navigate(target, { replace: true })
    },
  })

  if (loading) return <Loading />
  if (session) return <Navigate to={target} replace />

  function submit(e: FormEvent) {
    e.preventDefault()
    login.mutate()
  }

  return (
    <div className="admin">
      <main className="narrow" style={{ padding: '4rem 0', maxWidth: 440 }}>
        <p className="brand" style={{ marginBottom: '1.5rem' }}>
          croot
        </p>
        <div className="card">
          <h1>Sign in</h1>
          <p className="muted">For retreat organisers. Guests use the private link their organiser sent them.</p>
          <form onSubmit={submit} noValidate>
            <Field id="login-email" label="Email" error={fieldError(login.error, 'email')}>
              <input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="login-password" label="Password" error={fieldError(login.error, 'password')}>
              <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <MutationError error={login.error} shownFields={['email', 'password']} />
            <button className="btn" type="submit" disabled={login.isPending} style={{ marginTop: '0.5rem' }}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="small muted" style={{ marginTop: '1.5rem' }}>
            Forgotten your password? Ask an owner of your organisation to issue you a new setup link.
          </p>
        </div>
      </main>
    </div>
  )
}
