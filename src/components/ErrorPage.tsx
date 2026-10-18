import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

// Trang báo lỗi theo mã: 401 chưa đăng nhập, 403 không có quyền, 404 không tìm thấy.
// App chạy hoàn toàn ở trình duyệt nên đây là trang hiển thị; dữ liệu vẫn do DB (RLS) chặn.
export function ErrorPage({
  code,
  title,
  message,
  children,
}: {
  code: 401 | 403 | 404
  title: string
  message: string
  children?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="error-page" role="alert">
      <div className="error-code" aria-hidden="true">
        {code}
      </div>
      <h1>{t(title)}</h1>
      <p className="muted">{t(message)}</p>
      {children && <div className="error-actions">{children}</div>}
    </div>
  )
}
