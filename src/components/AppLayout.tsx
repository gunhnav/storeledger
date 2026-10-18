import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { BRAND_NAME } from '../lib/brand'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { useTheme, type ThemeMode } from '../lib/theme'
import { ErrorPage } from './ErrorPage'
import { Icon, type IconName } from './Icon'
import { LanguageSelect } from './LanguageSelect'
import { Logo } from './Logo'

type NavItem = { to: string; label: string; icon: IconName; adminOnly?: boolean }

// Menu gọn theo nhóm công việc; trang con là tab bên trong (xem App.tsx).
// Nhân viên nằm trong menu ở tên người dùng (chỉ quản trị).
const NAV_ITEMS: NavItem[] = [
  { to: '/sales', label: 'Bán hàng', icon: 'sale' },
  { to: '/inventory', label: 'Kho hàng', icon: 'stock' },
  { to: '/reports', label: 'Báo cáo', icon: 'report', adminOnly: true },
  { to: '/manage', label: 'Quản lý', icon: 'manage', adminOnly: true },
]

// Chữ cái đầu của tên để làm avatar
function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

export function AppLayout() {
  const { profile, isAdmin, signOut } = useAuth()
  const { stores, current, loading, error, select } = useStore()
  const navigate = useNavigate()
  const { t } = useI18n()

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)
  const displayName = profile?.full_name || (isAdmin ? 'Admin' : t('Nhân viên'))

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-row">
            <span className="brand">
              <Logo size={36} />
              <span className="brand-text">{BRAND_NAME}</span>
            </span>
            <span className="store-pill">
              <Icon name="store" size={16} />
              {stores.length > 1 ? (
                <select
                  aria-label={t('Cửa hàng')}
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
            <UserMenu
              name={displayName}
              isAdmin={isAdmin}
              onSignOut={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            />
          </div>
          <nav className="nav">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to}>
                <Icon name={item.icon} />
                <span>{t(item.label)}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="content">
        {loading ? (
          <p className="muted">{t('Đang tải cửa hàng…')}</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : !current ? (
          <ErrorPage
            code={403}
            title={t('Chưa được phân quyền cửa hàng')}
            message="Tài khoản của bạn chưa được thêm vào cửa hàng nào. Liên hệ quản trị để được cấp quyền."
          />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}

const THEME_CHOICES: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Sáng', icon: 'sun' },
  { value: 'dark', label: 'Tối', icon: 'moon' },
  { value: 'system', label: 'Theo máy', icon: 'monitor' },
]

// Menu ở tên người dùng: tài khoản, giao diện sáng / tối, Nhân viên (chỉ quản trị), đăng xuất
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
  const { mode, change } = useTheme()
  const { t } = useI18n()
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
          <span className="user-role">{isAdmin ? t('Quản trị') : t('Nhân viên')}</span>
        </span>
        <span className={`caret${open ? ' up' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <strong>{name}</strong>
            <span className="muted">{isAdmin ? t('Quản trị') : t('Nhân viên')}</span>
          </div>
          <NavLink to="/account" role="menuitem" className="user-dropdown-item">
            <Icon name="user" />
            {t('Tài khoản của tôi')}
          </NavLink>
          <div className="theme-switch" role="radiogroup" aria-label={t('Giao diện')}>
            {THEME_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={mode === choice.value}
                className={mode === choice.value ? 'active' : undefined}
                onClick={() => change(choice.value)}
                title={t(choice.label)}
              >
                <Icon name={choice.icon} size={16} />
                <span>{t(choice.label)}</span>
              </button>
            ))}
          </div>
          <div className="user-dropdown-lang">
            <Icon name="globe" size={16} />
            <LanguageSelect variant="pills" />
          </div>
          {isAdmin && (
            <NavLink to="/staff" role="menuitem" className="user-dropdown-item">
              <Icon name="staff" />
              {t('Nhân viên')}
            </NavLink>
          )}
          <button type="button" role="menuitem" className="user-dropdown-item danger" onClick={onSignOut}>
            <Icon name="logout" />
            {t('Đăng xuất')}
          </button>
        </div>
      )}
    </div>
  )
}
