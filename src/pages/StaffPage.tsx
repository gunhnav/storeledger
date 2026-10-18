import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { errorMessage } from '../lib/format'
import type { AdminUserRow } from '../types/database'

type FormValues = { full_name: string; email: string; password: string; store_ids: string[] }

const EMPTY: FormValues = { full_name: '', email: '', password: '', store_ids: [] }

type AdminUsersBody =
  | { action: 'create'; email: string; password: string; full_name: string; store_ids: string[] }
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
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY })

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
        store_ids: values.store_ids,
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
      <form className="card form" onSubmit={handleSubmit(onCreate)}>
        <div className="row">
          <label>
            {t('Tên nhân viên')}
            <input
              type="text"
              {...register('full_name', { validate: (v) => v.trim() !== '' || 'Nhập tên nhân viên' })}
            />
          </label>
          <label>
            {t('Email đăng nhập')}
            <input type="email" autoComplete="off" {...register('email', { required: 'Nhập email' })} />
          </label>
          <label>
            {t('Mật khẩu')}
            <input
              type="text"
              autoComplete="new-password"
              {...register('password', {
                minLength: { value: 6, message: 'Mật khẩu phải có ít nhất 6 ký tự' },
                required: 'Nhập mật khẩu',
              })}
            />
          </label>
        </div>
        {(errors.full_name || errors.email || errors.password) && (
          <p className="error">
            {t((errors.full_name?.message ?? errors.email?.message ?? errors.password?.message) ?? '')}
          </p>
        )}

        <div>
          <span className="field-label">{t('Làm việc tại')}</span>
          <div className="row">
            {stores.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" value={s.id} {...register('store_ids')} />
                {s.name}
              </label>
            ))}
          </div>
        </div>

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
                {stores.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
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
                    {stores.map((s) => {
                      const member = user.store_ids.includes(s.id)
                      return (
                        <td key={s.id}>
                          {isAdminRow ? (
                            <small className="muted">{t('Tất cả')}</small>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={t('{value} làm tại {name}', { value: user.full_name ?? user.email, name: s.name })}
                              checked={member}
                              disabled={busy === user.id}
                              onChange={() => toggleStore(user, s.id, member)}
                            />
                          )}
                        </td>
                      )
                    })}
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
                        <button
                          type="button"
                          className="link"
                          disabled={busy === user.id}
                          onClick={() => resetPassword(user)}
                        >
                          {t('Đổi mật khẩu')}
                        </button>
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
        {t('Bỏ chọn hết cửa hàng để khoá quyền nhập liệu của nhân viên (tài khoản vẫn đăng nhập được nhưng không thấy gì).')}
      </p>
    </section>
  )
}
