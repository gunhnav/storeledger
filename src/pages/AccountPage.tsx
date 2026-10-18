import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { LanguageSelect } from '../components/LanguageSelect'
import { errorMessage } from '../lib/format'
import { useTheme, type ThemeMode } from '../lib/theme'

type ProfileValues = { full_name: string; email: string }
type PasswordValues = { password: string; confirm: string }

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
  { value: 'system', label: 'Theo máy' },
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Mỗi người tự sửa tên, email đăng nhập, mật khẩu và chọn giao diện sáng / tối
export function AccountPage() {
  const { session, profile, isAdmin, refreshProfile } = useAuth()
  const { t } = useI18n()
  const toast = useToast()
  const { mode, change } = useTheme()
  const currentEmail = session?.user.email ?? ''
  const [profileResult, setProfileResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [passwordResult, setPasswordResult] = useState<{ ok: boolean; text: string } | null>(null)

  const profileForm = useForm<ProfileValues>({
    defaultValues: { full_name: profile?.full_name ?? '', email: currentEmail },
  })
  const passwordForm = useForm<PasswordValues>({ defaultValues: { password: '', confirm: '' } })

  const saveProfile = async (values: ProfileValues) => {
    setProfileResult(null)
    const fullName = values.full_name.trim()
    const email = values.email.trim().toLowerCase()
    const messages: string[] = []

    if (fullName !== (profile?.full_name ?? '')) {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', session?.user.id ?? '')
      if (error) return setProfileResult({ ok: false, text: errorMessage(error) })
      refreshProfile()
      messages.push(t('Đã lưu tên'))
    }

    // Đổi email: Supabase gửi thư xác nhận, chỉ đổi sau khi bấm link trong thư
    if (email !== currentEmail.toLowerCase()) {
      const { error } = await supabase.auth.updateUser({ email })
      if (error) return setProfileResult({ ok: false, text: errorMessage(error) })
      messages.push(t('Đã gửi thư xác nhận tới {email}, bấm link trong thư để hoàn tất đổi email', { email }))
    }

    setProfileResult({ ok: true, text: messages.length > 0 ? messages.join('. ') : t('Không có gì thay đổi') })
  }

  const savePassword = async (values: PasswordValues) => {
    setPasswordResult(null)
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) return setPasswordResult({ ok: false, text: errorMessage(error) })
    toast.success(t('Đã đổi mật khẩu'))
    passwordForm.reset({ password: '', confirm: '' })
  }

  const profileErrors = profileForm.formState.errors
  const passwordErrors = passwordForm.formState.errors

  return (
    <section className="account">
      <h2>{t('Tài khoản của tôi')}</h2>

      <form className="card form" onSubmit={profileForm.handleSubmit(saveProfile)}>
        <h3 className="card-title">{t('Thông tin')}</h3>
        <div className="row">
          <label>
            {t('Tên hiển thị')}
            <input
              type="text"
              {...profileForm.register('full_name', {
                validate: (v) =>
                  v.trim() === '' ? 'Nhập tên' : v.trim().length > 100 ? 'Tên tối đa 100 ký tự' : true,
              })}
            />
          </label>
          <label>
            {t('Email đăng nhập')}
            <input
              type="email"
              autoComplete="email"
              {...profileForm.register('email', {
                validate: (v) => EMAIL_PATTERN.test(v.trim()) || 'Email không hợp lệ',
              })}
            />
          </label>
        </div>
        <small className="muted">
          {t('Vai trò: {role}. Đổi email cần bấm link xác nhận gửi tới email mới.', {
            role: isAdmin ? t('Quản trị') : t('Nhân viên'),
          })}
        </small>
        {(profileErrors.full_name || profileErrors.email) && (
          <p className="error">{t(profileErrors.full_name?.message ?? profileErrors.email?.message ?? '')}</p>
        )}
        {profileResult && <p className={profileResult.ok ? 'success' : 'error'}>{t(profileResult.text)}</p>}
        <div>
          <button type="submit" className="primary" disabled={profileForm.formState.isSubmitting}>
            {profileForm.formState.isSubmitting ? t('Đang lưu…') : t('Lưu thông tin')}
          </button>
        </div>
      </form>

      <div className="card form">
        <h3 className="card-title">{t('Giao diện')}</h3>
        <div className="segmented" role="radiogroup" aria-label={t('Chế độ sáng tối')}>
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={mode === o.value}
              className={mode === o.value ? 'active' : undefined}
              onClick={() => change(o.value)}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
        <span className="field-label">{t('Ngôn ngữ')}</span>
        <LanguageSelect />
        <small className="muted">{t('Lựa chọn được lưu trên thiết bị này.')}</small>
      </div>

      <form className="card form" onSubmit={passwordForm.handleSubmit(savePassword)}>
        <h3 className="card-title">{t('Đổi mật khẩu')}</h3>
        <div className="row">
          <label>
            {t('Mật khẩu mới')}
            <input
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('password', {
                minLength: { value: 6, message: 'Mật khẩu phải có ít nhất 6 ký tự' },
                required: 'Nhập mật khẩu mới',
              })}
            />
          </label>
          <label>
            {t('Nhập lại mật khẩu')}
            <input
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('confirm', {
                validate: (v, all) => v === all.password || 'Hai mật khẩu không khớp',
              })}
            />
          </label>
        </div>
        {(passwordErrors.password || passwordErrors.confirm) && (
          <p className="error">{t(passwordErrors.password?.message ?? passwordErrors.confirm?.message ?? '')}</p>
        )}
        {passwordResult && <p className={passwordResult.ok ? 'success' : 'error'}>{t(passwordResult.text)}</p>}
        <div>
          <button type="submit" className="primary" disabled={passwordForm.formState.isSubmitting}>
            {passwordForm.formState.isSubmitting ? t('Đang lưu…') : t('Đổi mật khẩu')}
          </button>
        </div>
      </form>
    </section>
  )
}
