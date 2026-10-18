import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useStore } from '../lib/store'
import { errorMessage } from '../lib/format'
import type { AdminUserRow } from '../types/database'

type FormValues = { full_name: string; email: string; password: string; store_ids: string[] }

const EMPTY: FormValues = { full_name: '', email: '', password: '', store_ids: [] }

type AdminUsersBody =
  | { action: 'create'; email: string; password: string; full_name: string; store_ids: string[] }
  | { action: 'set_password'; user_id: string; password: string }

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

function formatDateTime(value: string | null): string {
  if (!value) return 'Chưa đăng nhập'
  return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

// Chỉ admin (route bọc RequireAdmin; RPC và Edge Function cũng tự kiểm tra)
export function StaffPage() {
  const { session } = useAuth()
  const { stores } = useStore()
  const [list, setList] = useState<{ rows: AdminUserRow[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
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
      setResult({ ok: true, text: `Đã tạo tài khoản cho ${values.full_name.trim()}` })
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
    const password = window.prompt(`Mật khẩu mới cho ${user.full_name || user.email} (ít nhất 6 ký tự):`)
    if (password === null) return
    setResult(null)
    setBusy(user.id)
    try {
      await callAdminUsers({ action: 'set_password', user_id: user.id, password })
      setResult({ ok: true, text: `Đã đổi mật khẩu cho ${user.full_name || user.email}` })
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) })
    }
    setBusy(null)
  }

  return (
    <section>
      <h2>Thêm nhân viên</h2>
      <form className="card form" onSubmit={handleSubmit(onCreate)}>
        <div className="row">
          <label>
            Tên nhân viên
            <input
              type="text"
              {...register('full_name', { validate: (v) => v.trim() !== '' || 'Nhập tên nhân viên' })}
            />
          </label>
          <label>
            Email đăng nhập
            <input type="email" autoComplete="off" {...register('email', { required: 'Nhập email' })} />
          </label>
        </div>
        <label>
          Mật khẩu
          <input
            type="text"
            autoComplete="new-password"
            {...register('password', {
              minLength: { value: 6, message: 'Mật khẩu phải có ít nhất 6 ký tự' },
              required: 'Nhập mật khẩu',
            })}
          />
        </label>
        {(errors.full_name || errors.email || errors.password) && (
          <p className="error">
            {errors.full_name?.message ?? errors.email?.message ?? errors.password?.message}
          </p>
        )}

        <div>
          <span className="field-label">Làm việc tại</span>
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
          {isSubmitting ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
      </form>

      <h2 className="section-title">Tài khoản</h2>
      {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
      {!list ? (
        <p className="muted">Đang tải…</p>
      ) : list.error ? (
        <p className="error">{list.error}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
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
                      {user.full_name || '(chưa có tên)'}
                      {isAdminRow && <span className="badge badge-ok"> admin</span>}
                      <br />
                      <small className="muted">{user.email}</small>
                      <br />
                      <small className="muted">Đăng nhập gần nhất: {formatDateTime(user.last_sign_in_at)}</small>
                    </td>
                    {stores.map((s) => {
                      const member = user.store_ids.includes(s.id)
                      return (
                        <td key={s.id}>
                          {isAdminRow ? (
                            <small className="muted">Tất cả</small>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`${user.full_name ?? user.email} làm tại ${s.name}`}
                              checked={member}
                              disabled={busy === user.id}
                              onChange={() => toggleStore(user, s.id, member)}
                            />
                          )}
                        </td>
                      )
                    })}
                    <td>
                      {user.id !== session?.user.id && (
                        <button
                          type="button"
                          className="link"
                          disabled={busy === user.id}
                          onClick={() => resetPassword(user)}
                        >
                          Đổi mật khẩu
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
        Bỏ chọn hết cửa hàng để khoá quyền nhập liệu của nhân viên (tài khoản vẫn đăng nhập được nhưng
        không thấy gì).
      </p>
    </section>
  )
}
