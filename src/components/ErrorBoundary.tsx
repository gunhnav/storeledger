import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

// Bắt lỗi bất ngờ khi vẽ giao diện: hiện trang báo lỗi + nút tải lại thay vì màn hình trống
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lỗi giao diện:', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <CrashScreen message={this.state.error.message} />
    return this.props.children
  }
}

function CrashScreen({ message }: { message: string }) {
  const { t } = useI18n()
  return (
    <div className="error-screen">
      <div className="error-page" role="alert">
        <div className="error-code" aria-hidden="true">
          !
        </div>
        <h1>{t('Đã có lỗi xảy ra')}</h1>
        <p className="muted">{t('Trang gặp lỗi không mong muốn. Tải lại trang để tiếp tục, dữ liệu đã lưu không bị mất.')}</p>
        <details className="error-details">
          <summary>{t('Chi tiết lỗi')}</summary>
          <code>{message}</code>
        </details>
        <div className="error-actions">
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            {t('Tải lại trang')}
          </button>
        </div>
      </div>
    </div>
  )
}
