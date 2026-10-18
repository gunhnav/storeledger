import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { errorMessage } from '../lib/format'
import type { AdminUserRow, UserRole } from '../types/database'
import { StorePicker } from '../components/StorePicker'
import { PasswordInput } from '../components/PasswordInput'
import { Icon, type IconName } from '../components/Icon'

type FormValues = { full_name: string; email: string; password: string; role: UserRole; store_ids: string[] }

const EMPTY: FormValues = { full_name: '', email: '', password: '', role: 'staff', store_ids: [] }

type AdminUsersBody =
  | { action: 'create'; email: string; password: string; full_name: string; store_ids: string[]; role: UserRole }
  | { action: 'set_password'; user_id: string; password: string }
  | { action: 'update'; user_id: string; full_name: string; email: string }

// Gọi Edge Function admin-users; lấy thông báo lỗi tiếng Việt từ body trả về
async function callAdminUsers(body: AdminUsersBody): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return
  if (error instanceof FunctionsHttpError) {
    const payload = await error.context.json().catch(() => null)
    if (payload?.error) throw new Error(payload.error)
  }
  throw error
}

const ROLE_CHOICES: { value: UserRole; label: string; hint: string; icon: IconName }[] = [
  { value: 'staff', label: 'Nhân viên', hint: 'Bán hàng và kho, không thấy giá vốn / lãi', icon: 'user' },
  { value: 'admin', label: 'Quản trị', hint: 'Thấy mọi cửa hàng, báo cáo, chi phí, tài khoản', icon: 'staff' },
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDateTime(value: string | null, locale: string): string | null {
  if (!value) return null
  return new Date(value).toLocaleString(locale, { timeZone: 'Asia/Ho_Chi_Minh' })
}

// Chỉ admin (route bọc RequireAdmin; RPC và Edge Function cũng tự kiểm tra)
export function StaffPage() {
  const { session, refreshProfile } = useAuth()
  const { t, lang } = useI18n()
  const toast = useToast()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const { stores } = useStore()
  const [list, setList] = useState<{ rows: AdminUserRow[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // Đang sửa tên / email của tài khoản nào
  const [editing, setEditing] = useState<{ id: string; full_name: string; email: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY, mode: 'onTouched' })
  const role = useWatch({ control, name: 'role' })

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_list_users').then(({ data, error }) => {
      if (!cancelled) setList({ rows: data ?? [], error: error ? errorMessage(error) : null })
    })
    return () => {
      cancelled = true
    }
  }, [version])

  const reload = () => setVersion((v) => v + 1)

  const onCreate = async (values: FormValues) => {
    setResult(null)
    try {
      await callAdminUsers({
        action: 'create',
        full_name: values.full_name.trim(),
        email: values.email.trim(),
        password: values.password,
        role: values.role,
        store_ids: values.role === 'admin' ? [] : values.store_ids,
      })
      toast.success(t('Đã tạo tài khoản cho {value}', { value: values.full_name.trim() }))
      reset(EMPTY)
      reload()
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) })
    }
  }

  const toggleStore = async (user: AdminUserRow, storeId: string, member: boolean) => {
    setResult(null)
    setBusy(user.id)
    const { error } = member
      ? await supabase.from('store_members').delete().eq('user_id', user.id).eq('store_id', storeId)
      : await supabase.from('store_members').insert({ user_id: user.id, store_id: storeId })
    setBusy(null)
    if (error) setResult({ ok: false, text: errorMessage(error) })
    reload()
  }

  // Cấp / thu hồi quyền admin (hàm admin_set_role tự chặn tự hạ quyền và mất admin cuối cùng)
  const changeRole = async (user: AdminUserRow, role: UserRole) => {
    const who = user.full_name || user.email
    const question =
      role === 'admin'
        ? t('Cấp quyền admin cho {value}? Người này sẽ thấy giá vốn, lãi, chi phí của mọi cửa hàng và quản lý được tài khoản.', { value: who })
        : t('Bỏ quyền admin của {value}? Tài khoản trở thành nhân viên, chỉ làm việc ở các cửa hàng được gán.', { value: who })
    if (!window.confirm(question)) return
    setResult(null)
    setBusy(user.id)
    const { error } = await supabase.rpc('admin_set_role', { p_user_id: user.id, p_role: role })
    setBusy(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(role === 'admin' ? t('Đã cấp quyền admin cho {value}', { value: who }) : t('Đã bỏ quyền admin của {value}', { value: who }))
    reload()
  }

  const resetPassword = async (user: AdminUserRow) => {
    const password = window.prompt(t('Mật khẩu mới cho {value} (ít nhất 6 ký tự):', { value: user.full_name || user.email }))
    if (password === null) return
    setResult(null)
    setBusy(user.id)
    try {
      await callAdminUsers({ action: 'set_password', user_id: user.id, password })
      toast.success(t('Đã đổi mật khẩu cho {value}', { value: user.full_name || user.email }))
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) })
    }
    setBusy(null)
  }

  const saveEdit = async () => {
    if (!editing) return
    const fullName = editing.full_name.trim()
    const email = editing.email.trim().toLowerCase()
    if (!fullName) return setResult({ ok: false, text: t('Nhập tên nhân viên') })
    if (fullName.length > 100) return setResult({ ok: false, text: t('Tên tối đa 100 ký tự') })
    if (!EMAIL_PATTERN.test(email)) return setResult({ ok: false, text: t('Email không hợp lệ') })
    setResult(null)
    setBusy(editing.id)
    try {
      await callAdminUsers({ action: 'update', user_id: editing.id, full_name: fullName, email })
      toast.success(t('Đã lưu thông tin {fullName}', { fullName }))
      if (editing.id === session?.user.id) refreshProfile()
      setEditing(null)
      reload()
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) })
    }
    setBusy(null)
  }

  return (
    <section>
      <h2>{t('Thêm nhân viên')}</h2>
      <form className="card form" noValidate onSubmit={handleSubmit(onCreate)}>
        <div className="row">
          <label>
            {t('Tên nhân viên')}
            <input
              type="text"
              aria-invalid={errors.full_name ? true : undefined}
              {...register('full_name', {
                validate: (v) => v.trim() !== '' || 'Nhập tên nhân viên',
                maxLength: { value: 100, message: 'Tên tối đa 100 ký tự' },
              })}
            />
            {errors.full_name && <small className="error">{t(errors.full_name.message ?? '')}</small>}
          </label>
          <label>
            {t('Email đăng nhập')}
            <input
              type="email"
              autoComplete="off"
              aria-invalid={errors.email ? true : undefined}
              {...register('email', {
                required: 'Nhập email',
                validate: (v) => EMAIL_PATTERN.test(v.trim()) || 'Email không hợp lệ',
              })}
            />
            {errors.email && <small className="error">{t(errors.email.message ?? '')}</small>}
          </label>
          <label>
            {t('Mật khẩu')}
            <PasswordInput
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              {...register('password', {
                minLength: { value: 6, message: 'Mật khẩu phải có ít nhất 6 ký tự' },
                required: 'Nhập mật khẩu',
              })}
            />
            {errors.password && <small className="error">{t(errors.password.message ?? '')}</small>}
          </label>
        </div>

        <div>
          <span className="field-label">{t('Vai trò')}</span>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <div className="role-picker" role="radiogroup" aria-label={t('Vai trò')}>
                {ROLE_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={field.value === choice.value}
                    className={field.value === choice.value ? 'role-card on' : 'role-card'}
                    onClick={() => field.onChange(choice.value)}
                  >
                    <Icon name={choice.icon} size={20} />
                    <span>
                      <strong>{t(choice.label)}</strong>
                      <small>{t(choice.hint)}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        {role === 'admin' ? (
          <p className="muted">{t('Admin thấy tất cả cửa hàng nên không cần chọn quán.')}</p>
        ) : (
          <div>
            <span className="field-label">{t('Làm việc tại')}</span>
            <Controller
              control={control}
              name="store_ids"
              render={({ field }) => (
                <StorePicker
                  stores={stores}
                  selected={field.value}
                  onToggle={(id) =>
                    field.onChange(field.value.includes(id) ? field.value.filter((v) => v !== id) : [...field.value, id])
                  }
                />
              )}
            />
          </div>
        )}

        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? t('Đang tạo…') : t('Tạo tài khoản')}
        </button>
      </form>

      <h2 className="section-title">{t('Tài khoản')}</h2>
      {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
      {!list ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : list.error ? (
        <p className="error">{t(list.error)}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Nhân viên')}</th>
                <th>{t('Làm việc tại')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((user) => {
                const isAdminRow = user.role === 'admin'
                return (
                  <tr key={user.id}>
                    <td>
                      {editing?.id === user.id ? (
                        <div className="staff-edit">
                          <input
                            type="text"
                            aria-label={t('Tên nhân viên')}
                            value={editing.full_name}
                            onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                          />
                          <input
                            type="email"
                            aria-label={t('Email đăng nhập')}
                            value={editing.email}
                            onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                          />
                          <div className="row">
                            <button type="button" className="primary" disabled={busy === user.id} onClick={saveEdit}>
                              {busy === user.id ? t('Đang lưu…') : t('Lưu')}
                            </button>
                            <button type="button" onClick={() => setEditing(null)} disabled={busy === user.id}>
                              {t('Huỷ')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {user.full_name || t('(chưa có tên)')}
                          {isAdminRow && <span className="badge badge-ok"> admin</span>}
                          <br />
                          <small className="muted">{user.email}</small>
                          <br />
                          <small className="muted">
                            {t('Đăng nhập gần nhất: {time}', {
                              time: formatDateTime(user.last_sign_in_at, locale) ?? t('Chưa đăng nhập'),
                            })}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {isAdminRow ? (
                        <span className="badge badge-ok">{t('Tất cả cửa hàng')}</span>
                      ) : (
                        <StorePicker
                          compact
                          stores={stores}
                          selected={user.store_ids}
                          disabled={busy === user.id}
                          onToggle={(id) => toggleStore(user, id, user.store_ids.includes(id))}
                          ariaLabel={(s) => t('{value} làm tại {name}', { value: user.full_name ?? user.email, name: s.name })}
                        />
                      )}
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="link"
                        disabled={busy === user.id || editing?.id === user.id}
                        onClick={() => {
                          setResult(null)
                          setEditing({ id: user.id, full_name: user.full_name ?? '', email: user.email })
                        }}
                      >
                        {t('Sửa')}
                      </button>
                      {user.id !== session?.user.id && (
                        <>
                          <button
                            type="button"
                            className="link"
                            disabled={busy === user.id}
                            onClick={() => resetPassword(user)}
                          >
                            {t('Đổi mật khẩu')}
                          </button>
                          <button
                            type="button"
                            className={isAdminRow ? 'link danger' : 'link'}
                            disabled={busy === user.id}
                            onClick={() => changeRole(user, isAdminRow ? 'staff' : 'admin')}
                          >
                            {isAdminRow ? t('Bỏ quyền admin') : t('Cấp quyền admin')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        {t('Bấm vào thẻ quán ở cột “Làm việc tại” để thêm hoặc bỏ quán cho nhân viên, lưu ngay không cần bấm Sửa. Admin luôn thấy tất cả cửa hàng.')}
        <br />
        {t('Bỏ chọn hết cửa hàng để khoá quyền nhập liệu của nhân viên (tài khoản vẫn đăng nhập được nhưng không thấy gì).')}
      </p>
    </section>
  )
}
