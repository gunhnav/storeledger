import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAdmin, RequireAuth } from './components/RequireAuth'
import { StoreProvider } from './components/StoreProvider'
import { TabsLayout, type Tab } from './components/TabsLayout'
import { useAuth } from './lib/auth'
import { DailyLogPage } from './pages/DailyLogPage'
import { ExpensePage } from './pages/ExpensePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductsPage } from './pages/ProductsPage'
import { PurchasePage } from './pages/PurchasePage'
import { ReportsPage } from './pages/ReportsPage'
import { SalePage } from './pages/SalePage'
import { StaffPage } from './pages/StaffPage'
import { StockPage } from './pages/StockPage'
import { TransferPage } from './pages/TransferPage'

// Menu đã gộp: mỗi nhóm một trang có tab
const STOCK_TABS: Tab[] = [
  { to: '/kho/nhap-hang', label: 'Nhập hàng', icon: 'purchase' },
  { to: '/kho/chuyen-hang', label: 'Chuyển ra quầy', icon: 'transfer' },
  { to: '/kho/ton-kho', label: 'Tồn kho', icon: 'stock' },
]
const REPORT_TABS: Tab[] = [
  { to: '/bao-cao/tong-quan', label: 'Tổng quan', icon: 'report' },
  { to: '/bao-cao/nhat-ky', label: 'Nhật ký ngày', icon: 'log' },
]
const MANAGE_TABS: Tab[] = [
  { to: '/quan-ly/san-pham', label: 'Sản phẩm', icon: 'product' },
  { to: '/quan-ly/chi-phi', label: 'Chi phí', icon: 'expense' },
]
const LEGACY_PATHS: [string, string][] = [
  ['nhap-hang', '/kho/nhap-hang'],
  ['chuyen-hang', '/kho/chuyen-hang'],
  ['ton-kho', '/kho/ton-kho'],
  ['nhat-ky', '/bao-cao/nhat-ky'],
  ['san-pham', '/quan-ly/san-pham'],
  ['chi-phi', '/quan-ly/chi-phi'],
]

// Mount lại StoreProvider khi đổi user để không giữ danh sách cửa hàng của user trước
function StoreScope() {
  const { session } = useAuth()
  return (
    <StoreProvider key={session?.user.id}>
      <AppLayout />
    </StoreProvider>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<StoreScope />}>
          <Route index element={<Navigate to="/ban-hang" replace />} />
          <Route path="ban-hang" element={<SalePage />} />
          <Route path="kho" element={<TabsLayout title="Kho hàng" tabs={STOCK_TABS} />}>
            <Route index element={<Navigate to="nhap-hang" replace />} />
            <Route path="nhap-hang" element={<PurchasePage />} />
            <Route path="chuyen-hang" element={<TransferPage />} />
            <Route path="ton-kho" element={<StockPage />} />
          </Route>
          <Route element={<RequireAdmin />}>
            <Route path="bao-cao" element={<TabsLayout title="Báo cáo" tabs={REPORT_TABS} />}>
              <Route index element={<Navigate to="tong-quan" replace />} />
              <Route path="tong-quan" element={<ReportsPage />} />
              <Route path="nhat-ky" element={<DailyLogPage />} />
            </Route>
            <Route path="quan-ly" element={<TabsLayout title="Quản lý" tabs={MANAGE_TABS} />}>
              <Route index element={<Navigate to="san-pham" replace />} />
              <Route path="san-pham" element={<ProductsPage />} />
              <Route path="chi-phi" element={<ExpensePage />} />
            </Route>
            <Route path="nhan-vien" element={<StaffPage />} />
          </Route>
          {/* Đường dẫn cũ trước khi gộp menu */}
          {LEGACY_PATHS.map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
