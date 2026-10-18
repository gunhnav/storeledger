import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useStore } from '../lib/store'
import { Icon, type IconName } from './Icon'

type NavItem = { to: string; label: string; icon: IconName; adminOnly?: boolean }

// Thêm mục mới ở đây khi có trang mới. Nhân viên để cuối cùng.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tồn kho', icon: 'stock' },
  { to: '/ban-hang', label: 'Bán hàng', icon: 'sale' },
  { to: '/chuyen-hang', label: 'Chuyển hàng', icon: 'transfer' },
  { to: '/nhap-hang', label: 'Nhập hàng', icon: 'purchase' },
  { to: '/chi-phi', label: 'Chi phí', icon: 'expense', adminOnly: true },
  { to: '/san-pham', label: 'Sản phẩm', icon: 'product', adminOnly: true },
  { to: '/bao-cao', label: 'Báo cáo', icon: 'report', adminOnly: true },
  { to: '/nhan-vien', label: 'Nhân viên', icon: 'staff', adminOnly: true },
]

// Chữ cái đầu của tên để làm avatar
function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

export function AppLayout() {
  const { profile, isAdmin, signOut } = useAuth()
  const { stores, current, loading, error, select } = useStore()

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)
  const displayName = profile?.full_name || (isAdmin ? 'Admin' : 'Nhân viên')

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-row">
            <span className="brand">
              <span className="brand-mark">
                <Icon name="leaf" size={20} />
              </span>
              <span className="brand-text">Nhập liệu</span>
            </span>
            <span className="store-pill">
              <Icon name="store" size={16} />
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
            </span>
            <span className="spacer" />
            <span className="user">
              <span className="avatar" aria-hidden="true">
                {initials(displayName)}
              </span>
              <span className="user-text">
                <span className="user-name">{displayName}</span>
                <span className="user-role">{isAdmin ? 'Quản trị' : 'Nhân viên'}</span>
              </span>
            </span>
            <button type="button" className="icon-button" onClick={() => signOut()} aria-label="Đăng xuất" title="Đăng xuất">
              <Icon name="logout" />
            </button>
          </div>
          <nav className="nav">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
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
