import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ErrorPage } from './ErrorPage'

export function RequireAuth() {
  const { session, profile, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <p className="center muted">Đang tải…</p>
  if (!session) {
    // Mở trang chủ khi chưa đăng nhập thì vào thẳng màn hình đăng nhập
    if (location.pathname === '/') return <Navigate to="/login" replace />
    return (
      <div className="error-screen">
        <ErrorPage
          code={401}
          title="Bạn chưa đăng nhập"
          message="Trang này cần đăng nhập. Phiên làm việc có thể đã hết hạn, đăng nhập lại để tiếp tục."
        >
          <Link to="/login" state={{ from: location.pathname }} className="button primary">
            Đăng nhập
          </Link>
        </ErrorPage>
      </div>
    )
  }
  if (!profile) {
    return (
      <div className="error-screen">
        <ErrorPage
          code={403}
          title="Tài khoản chưa được phân quyền"
          message="Tài khoản chưa có hồ sơ trong hệ thống. Liên hệ quản trị để được cấp quyền."
        >
          <button type="button" onClick={() => signOut()}>
            Đăng xuất
          </button>
        </ErrorPage>
      </div>
    )
  }
  return <Outlet />
}

// Trang chỉ dành cho quản trị: nhân viên vào sẽ thấy 403 (vẫn giữ menu để quay lại)
export function RequireAdmin() {
  const { isAdmin } = useAuth()
  if (!isAdmin) {
    return (
      <ErrorPage
        code={403}
        title="Không có quyền truy cập"
        message="Trang này chỉ dành cho quản trị. Nếu bạn cần dùng, hãy nhờ quản trị cấp quyền."
      >
        <Link to="/" className="button primary">
          Về trang bán hàng
        </Link>
      </ErrorPage>
    )
  }
  return <Outlet />
}
