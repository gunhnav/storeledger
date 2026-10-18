import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAdmin, RequireAuth } from './components/RequireAuth'
import { StoreProvider } from './components/StoreProvider'
import { useAuth } from './lib/auth'
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
          <Route index element={<StockPage />} />
          <Route path="ban-hang" element={<SalePage />} />
          <Route path="chuyen-hang" element={<TransferPage />} />
          <Route path="nhap-hang" element={<PurchasePage />} />
          <Route element={<RequireAdmin />}>
            <Route path="chi-phi" element={<ExpensePage />} />
            <Route path="san-pham" element={<ProductsPage />} />
            <Route path="nhan-vien" element={<StaffPage />} />
            <Route path="bao-cao" element={<ReportsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
