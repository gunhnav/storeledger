import { Link } from 'react-router-dom'
import { ErrorPage } from '../components/ErrorPage'
import { useI18n } from '../lib/i18n'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="error-screen">
      <ErrorPage
        code={404}
        title={t('Không tìm thấy trang')}
        message="Đường dẫn không tồn tại hoặc đã được đổi. Kiểm tra lại địa chỉ hoặc quay về trang bán hàng."
      >
        <Link to="/" className="button primary">
          {t('Về trang chủ')}
        </Link>
      </ErrorPage>
    </div>
  )
}
