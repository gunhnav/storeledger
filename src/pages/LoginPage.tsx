import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation } from 'react-router-dom'
import { LanguageSelect } from '../components/LanguageSelect'
import { Logo } from '../components/Logo'
import { BRAND_NAME, BRAND_SLOGAN } from '../lib/brand'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/format'

type FormValues = { email: string; password: string }

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>()

  if (loading) return <p className="center muted">{t('Đang tải…')}</p>
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
      <div className="login-lang">
        <LanguageSelect />
      </div>
      <form className="card form login-card" onSubmit={handleSubmit(onSubmit)}>
        <div className="login-brand">
          <Logo size={52} />
          <div>
            <h1>{BRAND_NAME}</h1>
            <p className="muted">{t(BRAND_SLOGAN)}</p>
          </div>
        </div>
        <label>
          {t('Email')}
          <input type="email" autoComplete="username" required {...register('email')} />
        </label>
        <label>
          {t('Mật khẩu')}
          <input
            type="password"
            autoComplete="current-password"
            required
            {...register('password')}
          />
        </label>
        {error && <p className="error">{t(error)}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? t('Đang đăng nhập…') : t('Đăng nhập')}
        </button>
      </form>
    </div>
  )
}
