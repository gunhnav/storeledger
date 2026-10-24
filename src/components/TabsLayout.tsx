import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { Icon, type IconName } from './Icon'

// adminOnly: tab chỉ quản trị thấy (nhân viên không thấy trong hàng tab)
export type Tab = { to: string; label: string; icon: IconName; adminOnly?: boolean }

// Trang nhóm: tiêu đề + hàng tab, nội dung tab hiện qua <Outlet />
export function TabsLayout({ title, hint, tabs }: { title: string; hint?: string; tabs: Tab[] }) {
  const { t } = useI18n()
  const { isAdmin } = useAuth()
  const visible = tabs.filter((tab) => !tab.adminOnly || isAdmin)
  return (
    <div className="tabs-page">
      <div className="tabs-head">
        <h2>{t(title)}</h2>
        {hint && <p className="tabs-hint muted">{t(hint)}</p>}
        <nav className="tabs" aria-label={t(title)}>
          {visible.map((tab) => (
            <NavLink key={tab.to} to={tab.to} className="tab">
              <Icon name={tab.icon} size={17} />
              <span>{t(tab.label)}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
