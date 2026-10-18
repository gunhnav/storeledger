import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="center">
      <p>Không tìm thấy trang.</p>
      <Link to="/">Về trang chủ</Link>
    </div>
  )
}
