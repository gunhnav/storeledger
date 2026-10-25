import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAdmin, RequireAuth } from './components/RequireAuth'
import { StoreProvider } from './components/StoreProvider'
import { TabsLayout, type Tab } from './components/TabsLayout'
import { Suspense, lazy, type ReactNode } from 'react'
import { useAuth } from './lib/auth'
import { useStore } from './lib/store'
import { usesDistribution, usesRevenueEntry } from './lib/storeFeatures'
import { AccountPage } from './pages/AccountPage'
import { BatchStatsPage } from './pages/BatchStatsPage'
import { BestSellersPage } from './pages/BestSellersPage'
import { DailyLogPage } from './pages/DailyLogPage'
import { DishRecipesPage } from './pages/DishRecipesPage'
import { ExpensePage } from './pages/ExpensePage'
import { ExpenseReport } from './pages/ExpenseReport'
import { GuidePage } from './pages/GuidePage'
import { ItemImportPage } from './pages/ItemImportPage'
import { ItemSalesPage } from './pages/ItemSalesPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PreordersPage } from './pages/PreordersPage'
import { ProductsPage } from './pages/ProductsPage'
import { PurchasePage } from './pages/PurchasePage'
import { ReportsPage } from './pages/ReportsPage'
import { RevenuePage } from './pages/RevenuePage'
const ShopPage = lazy(() => import('./pages/ShopPage').then((m) => ({ default: m.ShopPage })))
import { SalePage } from './pages/SalePage'
import { StaffPage } from './pages/StaffPage'
import { StockPage } from './pages/StockPage'
import { StorefrontPage } from './pages/StorefrontPage'
import { TransferPage } from './pages/TransferPage'

// Menu chia hai phần cho mọi quán: Nhập liệu = những gì người dùng tự nhập hoặc tải file lên;
// Báo cáo = số liệu hệ thống tự tính từ dữ liệu đã nhập. Mỗi phần là một trang có hàng tab.
// Hogi (bán theo món, có kho)
const HOGI_ENTRY_TABS: Tab[] = [
  { to: '/entry/sales', label: 'Bán hàng', icon: 'sale' },
  { to: '/entry/preorders', label: 'Đơn đặt trước', icon: 'log', adminOnly: true },
  { to: '/entry/purchases', label: 'Nhập hàng', icon: 'purchase' },
  { to: '/entry/transfers', label: 'Phân phối', icon: 'transfer' },
  { to: '/entry/expenses', label: 'Chi phí', icon: 'expense', adminOnly: true },
  { to: '/entry/products', label: 'Sản phẩm', icon: 'product', adminOnly: true },
  { to: '/entry/storefront', label: 'Trang khách', icon: 'store', adminOnly: true },
]
const HOGI_REPORT_TABS: Tab[] = [
  { to: '/reports/overview', label: 'Tổng quan', icon: 'report', adminOnly: true },
  { to: '/reports/stock', label: 'Tồn kho', icon: 'stock' },
  { to: '/reports/batches', label: 'Theo đợt nhập', icon: 'purchase', adminOnly: true },
  { to: '/reports/best-sellers', label: 'Bán chạy & gợi ý', icon: 'sale', adminOnly: true },
  { to: '/reports/daily-log', label: 'Nhật ký ngày', icon: 'log', adminOnly: true },
]
// Bún đậu (nhập doanh thu theo ngày, chỉ admin)
const ENTRY_TABS: Tab[] = [
  { to: '/entry/revenue', label: 'Doanh thu', icon: 'sale' },
  { to: '/entry/expenses', label: 'Chi phí', icon: 'expense' },
  { to: '/entry/items', label: 'Nhập mặt hàng', icon: 'purchase' },
  { to: '/entry/recipes', label: 'Định lượng', icon: 'stock' },
]
const REVENUE_REPORT_TABS: Tab[] = [
  { to: '/reports/overview', label: 'Tổng quan', icon: 'report' },
  { to: '/reports/expenses', label: 'Chi phí', icon: 'expense' },
  { to: '/reports/items', label: 'Mặt hàng bán', icon: 'product' },
]
// Đường dẫn cũ → đường dẫn mới, để link đã lưu vẫn dùng được
const LEGACY_PATHS: [string, string][] = [
  ['sales', '/entry'],
  ['inventory', '/entry/purchases'],
  ['inventory/purchases', '/entry/purchases'],
  ['inventory/transfers', '/entry/transfers'],
  ['inventory/transfer-grid', '/entry/transfers?view=grid'],
  ['inventory/stock', '/reports/stock'],
  ['manage', '/entry/expenses'],
  ['manage/products', '/entry/products'],
  ['manage/expenses', '/entry/expenses'],
  ['manage/recipes', '/entry/recipes'],
  ['manage/ingredients', '/entry/expenses'],
  ['ban-hang', '/entry'],
  ['kho', '/entry/purchases'],
  ['kho/nhap-hang', '/entry/purchases'],
  ['kho/chuyen-hang', '/entry/transfers'],
  ['kho/ton-kho', '/reports/stock'],
  ['nhap-hang', '/entry/purchases'],
  ['chuyen-hang', '/entry/transfers'],
  ['ton-kho', '/reports/stock'],
  ['bao-cao', '/reports'],
  ['bao-cao/tong-quan', '/reports/overview'],
  ['bao-cao/nhat-ky', '/reports/daily-log'],
  ['nhat-ky', '/reports/daily-log'],
  ['quan-ly', '/entry/expenses'],
  ['quan-ly/san-pham', '/entry/products'],
  ['quan-ly/chi-phi', '/entry/expenses'],
  ['san-pham', '/entry/products'],
  ['chi-phi', '/entry/expenses'],
  ['nhan-vien', '/staff'],
  ['huong-dan', '/guide'],
]

// Nhập liệu: tab theo loại quán; quán không có bước Phân phối (Bún đậu) thì ẩn tab đó
function EntryLayout() {
  const { current } = useStore()
  if (usesRevenueEntry(current?.code)) return <TabsLayout title="Nhập liệu" hint="Những mục cần bạn nhập hoặc tải file lên." tabs={ENTRY_TABS} />
  const tabs = usesDistribution(current?.code) ? HOGI_ENTRY_TABS : HOGI_ENTRY_TABS.filter((tab) => tab.to !== '/entry/transfers')
  return <TabsLayout title="Nhập liệu" hint="Những mục cần bạn nhập: bán hàng, nhập hàng, phân phối, chi phí, sản phẩm, trang khách." tabs={tabs} />
}

// Trang đầu của Nhập liệu
function EntryIndex() {
  const { current } = useStore()
  return <Navigate to={usesRevenueEntry(current?.code) ? '/entry/revenue' : '/entry/sales'} replace />
}

// Báo cáo: số liệu hệ thống tự tính, không cần nhập gì
function ReportsLayout() {
  const { current } = useStore()
  const tabs = usesRevenueEntry(current?.code) ? REVENUE_REPORT_TABS : HOGI_REPORT_TABS
  return <TabsLayout title="Báo cáo" hint="Hệ thống tự tính từ dữ liệu đã nhập, không cần nhập gì ở đây." tabs={tabs} />
}

// Trang đầu của Báo cáo: quản trị vào Tổng quan, nhân viên (chỉ có Tồn kho) vào Tồn kho
function ReportsIndex() {
  const { isAdmin } = useAuth()
  return <Navigate to={isAdmin ? '/reports/overview' : '/reports/stock'} replace />
}

// Trang riêng của quán nhập doanh thu (Bún đậu); quán khác vào thì về trang đầu Nhập liệu / Báo cáo
function RevenueOnly({ children, fallback }: { children: ReactNode; fallback: string }) {
  const { current } = useStore()
  if (current && !usesRevenueEntry(current.code)) return <Navigate to={fallback} replace />
  return children
}

// Trang theo món (bán hàng, kho, sản phẩm, báo cáo theo món...) không có ở quán nhập doanh thu
function ItemBased({ children, fallback }: { children: ReactNode; fallback: string }) {
  const { current } = useStore()
  if (usesRevenueEntry(current?.code)) return <Navigate to={fallback} replace />
  return children
}

// Mở thẳng link Phân phối ở quán không dùng bước này thì về Nhập hàng
function DistributionOnly({ children }: { children: ReactNode }) {
  const { current } = useStore()
  if (current && !usesDistribution(current.code)) return <Navigate to="/entry/purchases" replace />
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
      <Route path="/hogi" element={<Suspense fallback={<div className="shop"><p className="shop-state">Đang tải thực đơn…</p></div>}><ShopPage code="hogi" /></Suspense>} />
      <Route path="/shop/:code" element={<Suspense fallback={<div className="shop"><p className="shop-state">Đang tải thực đơn…</p></div>}><ShopPage /></Suspense>} />
      <Route element={<RequireAuth />}>
        <Route element={<StoreScope />}>
          <Route index element={<Navigate to="/entry" replace />} />
          <Route path="entry" element={<EntryLayout />}>
            <Route index element={<EntryIndex />} />
            {/* Hogi: bán theo món, có kho (nhân viên dùng được) */}
            <Route path="sales" element={<ItemBased fallback="/entry"><SalePage /></ItemBased>} />
            <Route path="purchases" element={<ItemBased fallback="/entry"><PurchasePage /></ItemBased>} />
            <Route path="transfers" element={<ItemBased fallback="/entry"><DistributionOnly><TransferPage /></DistributionOnly></ItemBased>} />
            <Route element={<RequireAdmin />}>
              <Route path="expenses" element={<ExpensePage />} />
              <Route path="products" element={<ItemBased fallback="/entry"><ProductsPage /></ItemBased>} />
              <Route path="preorders" element={<ItemBased fallback="/entry"><PreordersPage /></ItemBased>} />
              <Route path="storefront" element={<ItemBased fallback="/entry"><StorefrontPage /></ItemBased>} />
              {/* Bún đậu: nhập doanh thu theo ngày */}
              <Route path="revenue" element={<RevenueOnly fallback="/entry"><RevenuePage /></RevenueOnly>} />
              <Route path="items" element={<RevenueOnly fallback="/entry"><ItemImportPage /></RevenueOnly>} />
              <Route path="recipes" element={<RevenueOnly fallback="/entry"><DishRecipesPage /></RevenueOnly>} />
            </Route>
          </Route>
          <Route path="reports" element={<ReportsLayout />}>
            <Route index element={<ReportsIndex />} />
            <Route path="stock" element={<ItemBased fallback="/reports"><StockPage /></ItemBased>} />
            <Route element={<RequireAdmin />}>
              <Route path="overview" element={<ReportsPage />} />
              <Route path="batches" element={<ItemBased fallback="/reports/overview"><BatchStatsPage /></ItemBased>} />
              <Route path="best-sellers" element={<ItemBased fallback="/reports/overview"><BestSellersPage /></ItemBased>} />
              <Route path="daily-log" element={<ItemBased fallback="/reports/overview"><DailyLogPage /></ItemBased>} />
              <Route path="expenses" element={<RevenueOnly fallback="/reports/overview"><ExpenseReport /></RevenueOnly>} />
              <Route path="items" element={<RevenueOnly fallback="/reports/overview"><ItemSalesPage /></RevenueOnly>} />
            </Route>
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route element={<RequireAdmin />}>
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
