import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { useConfirm, usePrompt } from '../lib/confirm'
import { errorMessage } from '../lib/format'
import type { AdminUserRow, UserRole } from '../types/database'
import { StorePicker } from '../components/StorePicker'
import { PasswordInput } from '../components/PasswordInput'
import { Icon, type IconName } from '../components/Icon'

const MASTER_EMAIL = (import.meta.env.VITE_MASTER_ADMIN_EMAIL ?? '').trim().toLowerCase()

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
  { value: 'super_admin', label: 'Super Admin', hint: 'Cấp cao nhất, toàn quyền hệ thống và bảo mật', icon: 'staff' },
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDateTime(value: string | null, locale: string): string | null {
  if (!value) return null
  return new Date(value).toLocaleString(locale, { timeZone: 'Asia/Ho_Chi_Minh' })
}

// Chỉ admin (route bọc RequireAdmin; RPC và Edge Function cũng tự kiểm tra)
export function StaffPage() {
  const { session, refreshProfile, isSuperAdmin } = useAuth()
  const { t, lang } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const { stores } = useStore()
  const [list, setList] = useState<{ rows: AdminUserRow[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // Đang sửa tên / email của tài khoản nào
  const [editing, setEditing] = useState<{ id: string; full_name: string; email: string } | null>(null)
  // Phân quyền cho tài khoản chờ duyệt
  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>({})
  const [pendingStores, setPendingStores] = useState<Record<string, string[]>>({})

  const availableChoices = ROLE_CHOICES.filter((c) => c.value !== 'super_admin' || isSuperAdmin)

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
        store_ids: values.role === 'staff' ? values.store_ids : [],
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

  // Cấp / thu hồi quyền admin & super admin (hàm admin_set_role tự chặn tự hạ quyền và mất admin cuối cùng)
  const changeRole = async (user: AdminUserRow, newRole: UserRole) => {
    const who = user.full_name || user.email
    let question = ''
    let title = ''
    let confirmText = ''
    let danger = false

    if (newRole === 'super_admin') {
      title = t('Cấp quyền Super Admin')
      confirmText = t('Cấp quyền Super Admin')
      question = t('Cấp quyền Super Admin cho {value}? Người này sẽ có toàn quyền cao nhất, bao gồm phân quyền và bảo mật.', { value: who })
    } else if (newRole === 'admin') {
      title = t('Cấp quyền admin')
      confirmText = t('Cấp quyền admin')
      question = t('Cấp quyền admin cho {value}? Người này sẽ thấy giá vốn, lãi, chi phí của mọi cửa hàng và quản lý được tài khoản.', { value: who })
    } else {
      title = t('Bỏ quyền admin')
      confirmText = t('Bỏ quyền admin')
      question = t('Bỏ quyền admin của {value}? Tài khoản trở thành nhân viên, chỉ làm việc ở các cửa hàng được gán.', { value: who })
      danger = true
    }

    const ok = await confirm({
      title,
      message: question,
      confirmText,
      cancelText: t('Đóng'),
      danger,
    })
    if (!ok) return
    setResult(null)
    setBusy(user.id)
    const { error } = await supabase.rpc('admin_set_role', { p_user_id: user.id, p_role: newRole })
    setBusy(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    if (newRole === 'super_admin') {
      toast.success(t('Đã cấp quyền Super Admin cho {value}', { value: who }))
    } else if (newRole === 'admin') {
      toast.success(t('Đã cấp quyền admin cho {value}', { value: who }))
    } else {
      toast.success(t('Đã bỏ quyền admin của {value}', { value: who }))
    }
    reload()
  }

  // Duyệt và phân quyền tài khoản chờ duyệt
  const approvePending = async (user: AdminUserRow) => {
    const assignedRole = pendingRoles[user.id] ?? 'staff'
    const assignedStores = pendingStores[user.id] ?? []
    setResult(null)
    setBusy(user.id)
    const { error } = await supabase.rpc('admin_approve_user', {
      p_user_id: user.id,
      p_role: assignedRole,
      p_store_ids: assignedRole === 'staff' ? assignedStores : [],
    })
    setBusy(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(t('Đã phê duyệt và phân quyền cho {value}', { value: user.full_name || user.email }))
    reload()
  }

  // Khôi phục quyền tài khoản đã bị từ chối
  const reapproveUser = async (user: AdminUserRow) => {
    setResult(null)
    setBusy(user.id)
    const { error } = await supabase.rpc('admin_approve_user', {
      p_user_id: user.id,
      p_role: user.role,
      p_store_ids: user.store_ids,
    })
    setBusy(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(t('Đã khôi phục quyền cho {value}', { value: user.full_name || user.email }))
    reload()
  }

  // Từ chối hoặc thu hồi quyền truy cập
  const rejectUser = async (user: AdminUserRow) => {
    const who = user.full_name || user.email
    const ok = await confirm({
      title: t('Từ chối tài khoản'),
      message: t('Từ chối tài khoản {value}?', { value: who }),
      confirmText: t('Từ chối'),
      cancelText: t('Đóng'),
      danger: true,
    })
    if (!ok) return
    setResult(null)
    setBusy(user.id)
    const { error } = await supabase.rpc('admin_reject_user', { p_user_id: user.id })
    setBusy(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(t('Đã từ chối tài khoản {value}', { value: who }))
    reload()
  }

  const resetPassword = async (user: AdminUserRow) => {
    const who = user.full_name || user.email
    const password = await prompt({
      title: t('Đổi mật khẩu cho {value}', { value: who }),
      message: t('Mật khẩu mới (ít nhất 6 ký tự):'),
      placeholder: t('Nhập mật khẩu mới…'),
      type: 'password',
      confirmText: t('Lưu mật khẩu'),
      cancelText: t('Đóng'),
      minLength: 6,
      required: true,
    })
    if (!password) return
    setResult(null)
    setBusy(user.id)
    try {
      await callAdminUsers({ action: 'set_password', user_id: user.id, password })
      toast.success(t('Đã đổi mật khẩu cho {value}', { value: who }))
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

  const pendingUsers = (list?.rows ?? []).filter((u) => u.status === 'pending')
  const activeUsers = (list?.rows ?? []).filter((u) => u.status !== 'pending')

  return (
    <section>
      {/* Hàng chờ phê duyệt đăng nhập Google */}
      {pendingUsers.length > 0 && (
        <div className="approval-queue">
          <div className="approval-queue-header">
            <h3>
              <Icon name="staff" size={20} />
              {t('Hàng chờ phê duyệt')}
              <span className="approval-queue-count">{pendingUsers.length}</span>
            </h3>
          </div>
          <p className="muted">
            {t('Tài khoản mới đăng nhập qua Google cần được quản trị viên phê duyệt vai trò và gán cửa hàng.')}
          </p>
          <div className="approval-list">
            {pendingUsers.map((user) => {
              const assignedRole = pendingRoles[user.id] ?? 'staff'
              const assignedStores = pendingStores[user.id] ?? []
              return (
                <div key={user.id} className="approval-card">
                  <div className="approval-card-top">
                    <div>
                      <strong>{user.full_name || t('(chưa có tên)')}</strong>
                      <span className="badge badge-low" style={{ marginLeft: 8 }}>
                        {t('Chờ duyệt')}
                      </span>
                      <br />
                      <small className="muted">{user.email}</small>
                      <br />
                      <small className="muted">
                        {t('Đăng nhập gần nhất: {time}', {
                          time: formatDateTime(user.created_at, locale) ?? t('Chưa đăng nhập'),
                        })}
                      </small>
                    </div>
                    <div className="approval-card-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === user.id}
                        onClick={() => approvePending(user)}
                      >
                        {busy === user.id ? t('Đang lưu…') : t('Phê duyệt & Phân quyền')}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy === user.id}
                        onClick={() => rejectUser(user)}
                      >
                        {t('Từ chối')}
                      </button>
                    </div>
                  </div>

                  <div className="approval-card-options">
                    <span className="field-label">{t('Vai trò')}</span>
                    <div className="role-picker" role="radiogroup" aria-label={t('Vai trò')}>
                      {availableChoices.map((choice) => (
                        <button
                          key={choice.value}
                          type="button"
                          role="radio"
                          aria-checked={assignedRole === choice.value}
                          className={assignedRole === choice.value ? 'role-card on' : 'role-card'}
                          onClick={() => setPendingRoles((prev) => ({ ...prev, [user.id]: choice.value }))}
                        >
                          <Icon name={choice.icon} size={18} />
                          <span>
                            <strong>{t(choice.label)}</strong>
                            <small>{t(choice.hint)}</small>
                          </span>
                        </button>
                      ))}
                    </div>

                    {assignedRole === 'staff' && (
                      <div style={{ marginTop: 12 }}>
                        <span className="field-label">{t('Làm việc tại')}</span>
                        <StorePicker
                          stores={stores}
                          selected={assignedStores}
                          onToggle={(id) =>
                            setPendingStores((prev) => ({
                              ...prev,
                              [user.id]: assignedStores.includes(id)
                                ? assignedStores.filter((v) => v !== id)
                                : [...assignedStores, id],
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tạo tài khoản thủ công qua email/password */}
      <details className="staff-manual-details">
        <summary>
          <strong>{t('Tạo tài khoản thủ công (email & mật khẩu)')}</strong>
        </summary>
        <form className="card form" noValidate onSubmit={handleSubmit(onCreate)} style={{ marginTop: 14 }}>
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
                  {availableChoices.map((choice) => (
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

          {role !== 'staff' ? (
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
      </details>

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
                <th>{t('Trạng thái')}</th>
                <th>{t('Làm việc tại')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((user) => {
                const isMainSuper = (user.email ?? '').toLowerCase() === 'hungng28900@gmail.com'
                const isSuperAdminRow = user.role === 'super_admin' || isMainSuper
                const isAdminRow = user.role === 'admin'
                const isMaster = (user.email ?? '').toLowerCase() === MASTER_EMAIL || isMainSuper
                const isSelf = user.id === session?.user.id
                const isRejected = user.status === 'rejected'
                const canManageUser = !isSelf && !isMainSuper && (!isSuperAdminRow || isSuperAdmin)

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
                          <strong>{user.full_name || t('(chưa có tên)')}</strong>
                          {isSuperAdminRow ? (
                            <span className="badge badge-master" style={{ marginLeft: 6 }}>
                              👑 Super Admin
                            </span>
                          ) : isMaster ? (
                            <span className="badge badge-master" style={{ marginLeft: 6 }}>
                              👑 {t('Quản trị chính')}
                            </span>
                          ) : isAdminRow ? (
                            <span className="badge badge-ok" style={{ marginLeft: 6 }}>
                              admin
                            </span>
                          ) : null}
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
                      {isRejected ? (
                        <span className="badge badge-out">{t('Bị từ chối')}</span>
                      ) : (
                        <span className="badge badge-ok">{t('Đã duyệt')}</span>
                      )}
                    </td>
                    <td>
                      {isAdminRow || isSuperAdminRow ? (
                        <span className="badge badge-ok">{t('Tất cả cửa hàng')}</span>
                      ) : isRejected ? (
                        <span className="muted">—</span>
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
                      {canManageUser && (
                        <>
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
                          <button
                            type="button"
                            className="link"
                            disabled={busy === user.id}
                            onClick={() => resetPassword(user)}
                          >
                            {t('Đổi mật khẩu')}
                          </button>

                          {isRejected ? (
                            <button
                              type="button"
                              className="link"
                              disabled={busy === user.id}
                              onClick={() => reapproveUser(user)}
                            >
                              {t('Duyệt lại')}
                            </button>
                          ) : (
                            <>
                              {isSuperAdmin && (
                                isSuperAdminRow ? (
                                  <button
                                    type="button"
                                    className="link danger"
                                    disabled={busy === user.id}
                                    onClick={() => changeRole(user, 'admin')}
                                  >
                                    {t('Hạ xuống Admin')}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="link"
                                    disabled={busy === user.id}
                                    onClick={() => changeRole(user, 'super_admin')}
                                  >
                                    {t('Cấp quyền Super Admin')}
                                  </button>
                                )
                              )}
                              {!isSuperAdminRow && (
                                <button
                                  type="button"
                                  className={isAdminRow ? 'link danger' : 'link'}
                                  disabled={busy === user.id}
                                  onClick={() => changeRole(user, isAdminRow ? 'staff' : 'admin')}
                                >
                                  {isAdminRow ? t('Bỏ quyền admin') : t('Cấp quyền admin')}
                                </button>
                              )}
                              <button
                                type="button"
                                className="link danger"
                                disabled={busy === user.id}
                                onClick={() => rejectUser(user)}
                              >
                                {t('Khoá quyền')}
                              </button>
                            </>
                          )}
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
