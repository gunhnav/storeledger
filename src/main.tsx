import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './components/AuthProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { I18nProvider } from './components/I18nProvider'
import { ToastProvider } from './components/ToastProvider'
import { ConfirmProvider } from './components/ConfirmProvider'
import { UpdateWatcher } from './components/UpdateWatcher'
import { liftSlip, takeSlipArrival } from './lib/slip'

// Đến từ website khác theo Slip Node (Sổ Xanh ⇄ Hogi Food): nhận màu, dọn URL trước khi router đọc
const slipColour = takeSlipArrival()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <AuthProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              <UpdateWatcher />
            </AuthProvider>
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
)

// Nội dung đầu tiên đã render: mở lớp màu chuyển cảnh
if (slipColour) liftSlip(slipColour)
