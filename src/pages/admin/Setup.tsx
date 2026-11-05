import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { get, post } from '../../lib/api'
import { useAuth, type Session } from '../../lib/auth'
import { Field } from '../../components/Controls'
import { Loading } from '../../components/States'
import { fieldError, MutationError } from './adminUi'

const MIN_LENGTH = 12

export default function Setup() {
  const { token = '' } = useParams()
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const info = useQuery({
    queryKey: ['setup', token],
    queryFn: () => get<{ email: string; name: string }>(`/api/auth/setup/${encodeURIComponent(token)}`),
    retry: false,
  })

  const save = useMutation({
    mutationFn: () => post<Session>(`/api/auth/setup/${encodeURIComponent(token)}`, { password }),
    onSuccess: (s) => {
      setSession(s)
      navigate('/admin', { replace: true })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < MIN_LENGTH) return setLocalError(`Use at least ${MIN_LENGTH} characters.`)
    if (password !== confirm) return setLocalError('The two passwords do not match.')
    setLocalError(null)
    save.mutate()
  }

  return (
    <div className="admin">
      <main className="narrow" style={{ padding: '4rem 0', maxWidth: 480 }}>
        <p className="brand" style={{ marginBottom: '1.5rem' }}>
          <img className="brand-logo" src="/croot-logo.svg" alt="Croot" />
        </p>
        <div className="card">
          {info.isLoading && <Loading />}
          {info.isError && (
            <>
              <h1>This setup link can’t be used</h1>
              <p>It may have expired or already been used. Ask the person who invited you to issue a new link.</p>
            </>
          )}
          {info.data && (
            <>
              <h1>Choose a password</h1>
              <p className="muted">
                Welcome, {info.data.name}. You’ll sign in as <strong>{info.data.email}</strong>. This link works once.
              </p>
              <form onSubmit={submit} noValidate>
                <input type="email" autoComplete="username" value={info.data.email} readOnly hidden />
                <Field id="setup-password" label="New password" hint={`At least ${MIN_LENGTH} characters. A long phrase is easiest to remember.`} error={fieldError(save.error, 'password')}>
                  <input id="setup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="setup-password-hint" />
                </Field>
                <Field id="setup-confirm" label="Confirm password">
                  <input id="setup-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
                {localError && (
                  <div className="notice error" role="alert">
                    {localError}
                  </div>
                )}
                <MutationError error={save.error} shownFields={['password']} />
                <button className="btn" type="submit" disabled={save.isPending} style={{ marginTop: '0.5rem' }}>
                  {save.isPending ? 'Saving…' : 'Set password and continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
