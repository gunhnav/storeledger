import { Link } from 'react-router-dom'
import { ErrorPage } from '../components/ErrorPage'

export function NotFoundPage() {
  return (
    <div className="error-screen">
      <ErrorPage
        code={404}
        title="Không tìm thấy trang"
        message="Đường dẫn không tồn tại hoặc đã được đổi. Kiểm tra lại địa chỉ hoặc quay về trang bán hàng."
      >
        <Link to="/" className="button primary">
          Về trang chủ
        </Link>
      </ErrorPage>
    </div>
  )
}
