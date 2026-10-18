import { useI18n } from '../lib/i18n'
import type { StockAlerts, StockStatus } from '../lib/analytics/overview'

// Banner tồn tại quầy: đỏ (hết / cần kiểm tra), cam (sắp hết), xanh (ổn). Chỉ dùng số lượng.
export function StockAlertBanner({ alerts }: { alerts: StockAlerts }) {
  const { t } = useI18n()
  return (
    <div className={`stock-banner stock-banner-${alerts.level}`} role="status">
      {alerts.out.length > 0 && (
        <p>⚠ {t('HẾT HÀNG TẠI CỬA HÀNG: {list} → mang thêm ra quán!', { list: alerts.out.join(', ') })}</p>
      )}
      {alerts.check.length > 0 && <p>⚠ {t('KIỂM TRA số liệu: {list}', { list: alerts.check.join(', ') })}</p>}
      {alerts.low.length > 0 && <p>{t('SẮP HẾT: {list}', { list: alerts.low.join(', ') })}</p>}
      {alerts.level === 'green' && <p>✓ {t('Tồn tại quán ổn')}</p>}
    </div>
  )
}

const BADGE: Record<StockStatus, string> = {
  not_moved: 'badge-muted',
  out: 'badge-out',
  check: 'badge-out',
  low: 'badge-low',
  ok: 'badge-ok',
}
const LABEL: Record<StockStatus, string> = {
  not_moved: 'Chưa mang ra',
  out: 'HẾT',
  check: 'KIỂM TRA',
  low: 'Sắp hết',
  ok: 'Ổn',
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const { t } = useI18n()
  return <span className={`badge ${BADGE[status]}`}>{t(LABEL[status])}</span>
}
