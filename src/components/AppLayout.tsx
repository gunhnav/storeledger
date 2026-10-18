import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useStore } from '../lib/store'
import { Icon, type IconName } from './Icon'

type NavItem = { to: string; label: string; icon: IconName; adminOnly?: boolean }

// Thứ tự theo công việc hằng ngày. Thêm mục mới ở đây khi có trang mới.
// Nhân viên nằm trong menu ở tên người dùng (chỉ quản trị).
const NAV_ITEMS: NavItem[] = [
  { to: '/ban-hang', label: 'Bán hàng', icon: 'sale' },
  { to: '/chuyen-hang', label: 'Chuyển hàng', icon: 'transfer' },
  { to: '/nhap-hang', label: 'Nhập hàng', icon: 'purchase' },
  { to: '/chi-phi', label: 'Chi phí', icon: 'expense', adminOnly: true },
  { to: '/san-pham', label: 'Sản phẩm', icon: 'product', adminOnly: true },
  { to: '/ton-kho', label: 'Tồn kho', icon: 'stock' },
  { to: '/bao-cao', label: 'Báo cáo', icon: 'report', adminOnly: true },
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
            <UserMenu name={displayName} isAdmin={isAdmin} onSignOut={() => signOut()} />
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

// Menu ở tên người dùng: Nhân viên (chỉ quản trị) và Đăng xuất
function UserMenu({
  name,
  isAdmin,
  onSignOut,
}: {
  name: string
  isAdmin: boolean
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const [lastPath, setLastPath] = useState(location.pathname)

  // Chuyển trang thì đóng menu
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setOpen(false)
  }

  // Bấm ra ngoài hoặc nhấn Esc thì đóng menu
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="user-text">
          <span className="user-name">{name}</span>
          <span className="user-role">{isAdmin ? 'Quản trị' : 'Nhân viên'}</span>
        </span>
        <span className={`caret${open ? ' up' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <strong>{name}</strong>
            <span className="muted">{isAdmin ? 'Quản trị' : 'Nhân viên'}</span>
          </div>
          {isAdmin && (
            <NavLink to="/nhan-vien" role="menuitem" className="user-dropdown-item">
              <Icon name="staff" />
              Nhân viên
            </NavLink>
          )}
          <button type="button" role="menuitem" className="user-dropdown-item danger" onClick={onSignOut}>
            <Icon name="logout" />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  )
}
