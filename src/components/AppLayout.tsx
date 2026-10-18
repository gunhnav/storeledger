import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useStore } from '../lib/store'

type NavItem = { to: string; label: string; adminOnly?: boolean }

// Thêm mục mới ở đây khi có trang mới
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tồn kho' },
  { to: '/ban-hang', label: 'Bán hàng' },
  { to: '/chuyen-hang', label: 'Chuyển hàng' },
  { to: '/nhap-hang', label: 'Nhập hàng' },
  { to: '/chi-phi', label: 'Chi phí', adminOnly: true },
  { to: '/san-pham', label: 'Sản phẩm', adminOnly: true },
  { to: '/nhan-vien', label: 'Nhân viên', adminOnly: true },
  { to: '/bao-cao', label: 'Báo cáo', adminOnly: true },
]

export function AppLayout() {
  const { profile, isAdmin, signOut } = useAuth()
  const { stores, current, loading, error, select } = useStore()

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-row">
          <strong className="brand">Nhập liệu</strong>
          {stores.length > 1 ? (
            <select
              aria-label="Cửa hàng"
              value={current?.id ?? ''}
              onChange={(e) => select(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span>{current?.name}</span>
          )}
          <span className="spacer" />
          <span className="muted user">
            {profile?.full_name || (isAdmin ? 'Admin' : 'Nhân viên')}
          </span>
          <button type="button" className="link" onClick={() => signOut()}>
            Đăng xuất
          </button>
        </div>
        <nav className="nav">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        {loading ? (
          <p className="muted">Đang tải cửa hàng…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : !current ? (
          <p>Bạn chưa được thêm vào cửa hàng nào. Liên hệ admin.</p>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
