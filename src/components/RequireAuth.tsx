import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { ErrorPage } from './ErrorPage'

export function RequireAuth() {
  const { session, profile, loading, signOut } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const contactEmail = (import.meta.env.VITE_MASTER_ADMIN_EMAIL ?? '').trim()

  if (loading) return <p className="center muted">{t('Đang tải…')}</p>
  if (!session) {
    // Mở trang chủ khi chưa đăng nhập thì vào thẳng màn hình đăng nhập
    if (location.pathname === '/') return <Navigate to="/login" replace />
    return (
      <div className="error-screen">
        <ErrorPage
          code={401}
          title={t('Bạn chưa đăng nhập')}
          message="Trang này cần đăng nhập. Phiên làm việc có thể đã hết hạn, đăng nhập lại để tiếp tục."
        >
          <Link to="/login" state={{ from: location.pathname }} className="button primary">
            {t('Đăng nhập')}
          </Link>
        </ErrorPage>
      </div>
    )
  }
  if (!profile || profile.status === 'pending') {
    return (
      <div className="error-screen">
        <ErrorPage
          code={403}
          title={t('Tài khoản đang chờ duyệt')}
          message={t(
            'Tài khoản của bạn đã đăng nhập và đang trong hàng chờ phê duyệt. Quản trị viên sẽ sớm xác nhận và phân quyền cửa hàng cho bạn.',
          )}
        >
          {contactEmail && (
            <p className="muted" style={{ marginBottom: 14 }}>
              {t('Liên hệ quản trị viên:')} <strong>{contactEmail}</strong>
            </p>
          )}
          <button type="button" onClick={() => signOut()}>
            {t('Đăng xuất')}
          </button>
        </ErrorPage>
      </div>
    )
  }
  if (profile.status === 'rejected') {
    return (
      <div className="error-screen">
        <ErrorPage
          code={403}
          title={t('Tài khoản bị từ chối')}
          message={t('Tài khoản của bạn đã bị từ chối quyền truy cập. Vui lòng liên hệ quản trị viên.')}
        >
          {contactEmail && (
            <p className="muted" style={{ marginBottom: 14 }}>
              {t('Liên hệ quản trị viên:')} <strong>{contactEmail}</strong>
            </p>
          )}
          <button type="button" onClick={() => signOut()}>
            {t('Đăng xuất')}
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
  const { t } = useI18n()
  if (!isAdmin) {
    return (
      <ErrorPage
        code={403}
        title={t('Không có quyền truy cập')}
        message="Trang này chỉ dành cho quản trị. Nếu bạn cần dùng, hãy nhờ quản trị cấp quyền."
      >
        <Link to="/" className="button primary">
          {t('Về trang bán hàng')}
        </Link>
      </ErrorPage>
    )
  }
  return <Outlet />
}
