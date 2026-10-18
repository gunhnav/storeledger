import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAdmin, RequireAuth } from './components/RequireAuth'
import { StoreProvider } from './components/StoreProvider'
import { TabsLayout, type Tab } from './components/TabsLayout'
import { useAuth } from './lib/auth'
import { AccountPage } from './pages/AccountPage'
import { BatchStatsPage } from './pages/BatchStatsPage'
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
  { to: '/inventory/purchases', label: 'Nhập hàng', icon: 'purchase' },
  { to: '/inventory/transfers', label: 'Chuyển ra quầy', icon: 'transfer' },
  { to: '/inventory/stock', label: 'Tồn kho', icon: 'stock' },
]
const REPORT_TABS: Tab[] = [
  { to: '/reports/overview', label: 'Tổng quan', icon: 'report' },
  { to: '/reports/batches', label: 'Theo đợt nhập', icon: 'purchase' },
  { to: '/reports/daily-log', label: 'Nhật ký ngày', icon: 'log' },
]
const MANAGE_TABS: Tab[] = [
  { to: '/manage/products', label: 'Sản phẩm', icon: 'product' },
  { to: '/manage/expenses', label: 'Chi phí', icon: 'expense' },
]
// Đường dẫn tiếng Việt cũ → đường dẫn mới, để link đã lưu vẫn dùng được
const LEGACY_PATHS: [string, string][] = [
  ['ban-hang', '/sales'],
  ['kho', '/inventory'],
  ['kho/nhap-hang', '/inventory/purchases'],
  ['kho/chuyen-hang', '/inventory/transfers'],
  ['kho/ton-kho', '/inventory/stock'],
  ['nhap-hang', '/inventory/purchases'],
  ['chuyen-hang', '/inventory/transfers'],
  ['ton-kho', '/inventory/stock'],
  ['bao-cao', '/reports'],
  ['bao-cao/tong-quan', '/reports/overview'],
  ['bao-cao/nhat-ky', '/reports/daily-log'],
  ['nhat-ky', '/reports/daily-log'],
  ['quan-ly', '/manage'],
  ['quan-ly/san-pham', '/manage/products'],
  ['quan-ly/chi-phi', '/manage/expenses'],
  ['san-pham', '/manage/products'],
  ['chi-phi', '/manage/expenses'],
  ['nhan-vien', '/staff'],
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
          <Route index element={<Navigate to="/sales" replace />} />
          <Route path="sales" element={<SalePage />} />
          <Route path="inventory" element={<TabsLayout title="Kho hàng" tabs={STOCK_TABS} />}>
            <Route index element={<Navigate to="purchases" replace />} />
            <Route path="purchases" element={<PurchasePage />} />
            <Route path="transfers" element={<TransferPage />} />
            <Route path="stock" element={<StockPage />} />
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="reports" element={<TabsLayout title="Báo cáo" tabs={REPORT_TABS} />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<ReportsPage />} />
              <Route path="batches" element={<BatchStatsPage />} />
              <Route path="daily-log" element={<DailyLogPage />} />
            </Route>
            <Route path="manage" element={<TabsLayout title="Quản lý" tabs={MANAGE_TABS} />}>
              <Route index element={<Navigate to="products" replace />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="expenses" element={<ExpensePage />} />
            </Route>
            <Route path="staff" element={<StaffPage />} />
          </Route>
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
