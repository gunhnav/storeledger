import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function RequireAuth() {
  const { session, profile, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <p className="center muted">Đang tải…</p>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) {
    return (
      <div className="center">
        <p>Tài khoản chưa có hồ sơ. Liên hệ admin để được cấp quyền.</p>
        <button type="button" onClick={() => signOut()}>
          Đăng xuất
        </button>
      </div>
    )
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
