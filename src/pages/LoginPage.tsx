import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/format'

type FormValues = { email: string; password: string }

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>()

  if (loading) return <p className="center muted">Đang tải…</p>
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  const onSubmit = async ({ email, password }: FormValues) => {
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg === 'Invalid login credentials' ? 'Sai email hoặc mật khẩu' : msg)
    }
  }

  return (
    <div className="login">
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <h1>Đăng nhập</h1>
        <label>
          Email
          <input type="email" autoComplete="username" required {...register('email')} />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            autoComplete="current-password"
            required
            {...register('password')}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
