import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './components/AuthProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { I18nProvider } from './components/I18nProvider'
import { ToastProvider } from './components/ToastProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
)
