import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAdmin, RequireAuth } from './components/RequireAuth'
import { StoreProvider } from './components/StoreProvider'
import { TabsLayout, type Tab } from './components/TabsLayout'
import type { ReactNode } from 'react'
import { useAuth } from './lib/auth'
import { useStore } from './lib/store'
import { usesDistribution, usesRevenueEntry } from './lib/storeFeatures'
import { AccountPage } from './pages/AccountPage'
import { BatchStatsPage } from './pages/BatchStatsPage'
import { BestSellersPage } from './pages/BestSellersPage'
import { DailyLogPage } from './pages/DailyLogPage'
import { ExpensePage } from './pages/ExpensePage'
import { GuidePage } from './pages/GuidePage'
import { IngredientsPage } from './pages/IngredientsPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductsPage } from './pages/ProductsPage'
import { PurchasePage } from './pages/PurchasePage'
import { ReportsPage } from './pages/ReportsPage'
import { RevenuePage } from './pages/RevenuePage'
import { ShopPage } from './pages/ShopPage'
import { SalePage } from './pages/SalePage'
import { StaffPage } from './pages/StaffPage'
import { StockPage } from './pages/StockPage'
import { TransferPage } from './pages/TransferPage'

// Menu đã gộp: mỗi nhóm một trang có tab
const STOCK_TABS: Tab[] = [
  { to: '/inventory/purchases', label: 'Nhập hàng', icon: 'purchase' },
  { to: '/inventory/transfers', label: 'Phân phối', icon: 'transfer' },
  { to: '/inventory/stock', label: 'Tồn kho', icon: 'stock' },
]
const REPORT_TABS: Tab[] = [
  { to: '/reports/overview', label: 'Tổng quan', icon: 'report' },
  { to: '/reports/batches', label: 'Theo đợt nhập', icon: 'purchase' },
  { to: '/reports/best-sellers', label: 'Bán chạy & gợi ý', icon: 'sale' },
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
  ['huong-dan', '/guide'],
]

// Kho hàng: quán không có bước Phân phối (Bún đậu) thì ẩn tab đó
function InventoryLayout() {
  const { current } = useStore()
  if (usesRevenueEntry(current?.code)) return <Navigate to="/sales" replace />
  const tabs = usesDistribution(current?.code) ? STOCK_TABS : STOCK_TABS.filter((tab) => tab.to !== '/inventory/transfers')
  return <TabsLayout title="Kho hàng" tabs={tabs} />
}

// Quản lý: quán nhập doanh thu theo ngày (Bún đậu) chỉ còn Chi phí
function ManageLayout() {
  const { current } = useStore()
  const tabs = usesRevenueEntry(current?.code) ? MANAGE_TABS.filter((tab) => tab.to === '/manage/expenses') : MANAGE_TABS
  return <TabsLayout title="Quản lý" tabs={tabs} />
}

// Trang theo món (sản phẩm, nguyên liệu, báo cáo theo món...) không có ở quán nhập doanh thu: về trang chính của nhóm
function ItemBased({ children, fallback }: { children: ReactNode; fallback: string }) {
  const { current } = useStore()
  if (usesRevenueEntry(current?.code)) return <Navigate to={fallback} replace />
  return children
}

// /sales: quán nhập doanh thu thì hiện form doanh thu, còn lại là màn hình bán theo món
function SalesRoute() {
  const { current } = useStore()
  return usesRevenueEntry(current?.code) ? <RevenuePage /> : <SalePage />
}

// Báo cáo: quán nhập doanh thu chỉ còn tab Tổng quan
function ReportsLayout() {
  const { current } = useStore()
  const tabs = usesRevenueEntry(current?.code) ? REPORT_TABS.filter((tab) => tab.to === '/reports/overview') : REPORT_TABS
  return <TabsLayout title="Báo cáo" tabs={tabs} />
}

// Mở thẳng link Phân phối ở quán không dùng bước này thì về Nhập hàng
function DistributionOnly({ children }: { children: ReactNode }) {
  const { current } = useStore()
  if (current && !usesDistribution(current.code)) return <Navigate to="/inventory/purchases" replace />
  return children
}

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
      {/* Trang bán hàng công khai, không cần đăng nhập */}
      <Route path="/hogi" element={<ShopPage code="hogi" />} />
      <Route path="/shop/:code" element={<ShopPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<StoreScope />}>
          <Route index element={<Navigate to="/sales" replace />} />
          <Route path="sales" element={<SalesRoute />} />
          <Route path="inventory" element={<InventoryLayout />}>
            <Route index element={<Navigate to="purchases" replace />} />
            <Route path="purchases" element={<PurchasePage />} />
            <Route path="transfers" element={<DistributionOnly><TransferPage /></DistributionOnly>} />
            <Route path="transfer-grid" element={<Navigate to="/inventory/transfers?view=grid" replace />} />
            <Route path="stock" element={<StockPage />} />
          </Route>
          <Route path="account" element={<AccountPage />} />
            <Route path="guide" element={<GuidePage />} />
          <Route element={<RequireAdmin />}>
            <Route path="reports" element={<ReportsLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<ReportsPage />} />
              <Route path="batches" element={<ItemBased fallback="/reports/overview"><BatchStatsPage /></ItemBased>} />
              <Route path="best-sellers" element={<ItemBased fallback="/reports/overview"><BestSellersPage /></ItemBased>} />
              <Route path="daily-log" element={<ItemBased fallback="/reports/overview"><DailyLogPage /></ItemBased>} />
            </Route>
            <Route path="manage" element={<ManageLayout />}>
              <Route index element={<ItemBased fallback="/manage/expenses"><Navigate to="products" replace /></ItemBased>} />
              <Route path="products" element={<ItemBased fallback="/manage/expenses"><ProductsPage /></ItemBased>} />
              <Route path="expenses" element={<ExpensePage />} />
              <Route path="ingredients" element={<ItemBased fallback="/manage/expenses"><IngredientsPage /></ItemBased>} />
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
