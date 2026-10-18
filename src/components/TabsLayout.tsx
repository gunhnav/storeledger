import { NavLink, Outlet } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { Icon, type IconName } from './Icon'

export type Tab = { to: string; label: string; icon: IconName }

// Trang nhóm: tiêu đề + hàng tab, nội dung tab hiện qua <Outlet />
export function TabsLayout({ title, tabs }: { title: string; tabs: Tab[] }) {
  const { t } = useI18n()
  return (
    <div className="tabs-page">
      <div className="tabs-head">
        <h2>{t(title)}</h2>
        <nav className="tabs" aria-label={t(title)}>
          {tabs.map((tab) => (
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
