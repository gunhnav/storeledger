import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { StockAlertBanner } from '../components/StockAlertBanner'
import { useStockAlerts } from '../lib/useStockAlerts'
import { errorMessage } from '../lib/format'
import { usesDistribution } from '../lib/storeFeatures'
import type { StockStatus, StockStatusRow } from '../types/database'

const STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'Còn hàng',
  low: 'Sắp hết',
  out: 'Hết hàng',
}

export function StockPage() {
  const { current } = useStore()
  const { t } = useI18n()
  const alerts = useStockAlerts(current?.id ?? '')
  const storeId = current?.id
  const [result, setResult] = useState<{
    storeId: string
    rows: StockStatusRow[]
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    supabase.rpc('get_stock_status', { p_store_id: storeId }).then(({ data, error }) => {
      if (cancelled) return
      setResult({ storeId, rows: data ?? [], error: error ? errorMessage(error) : null })
    })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (!result || result.storeId !== storeId) return <p className="muted">{t('Đang tải tồn kho…')}</p>
  if (result.error) return <p className="error">{t(result.error)}</p>

  const hasCompany = result.rows.some((r) => (r.qty_company ?? 0) > 0)
  // Quán không có bước Phân phối: hàng nhập vào thẳng quán, không có tồn ở nhà
  const showHome = usesDistribution(current?.code)

  return (
    <section>
      {alerts && <StockAlertBanner alerts={alerts} />}
      {result.rows.length === 0 ? (
        <p className="muted">{t('Chưa có sản phẩm nào quản lý tồn kho.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Sản phẩm')}</th>
                {showHome && <th className="num">{t('Ở nhà')}</th>}
                <th className="num">{t('Ở quán')}</th>
                {hasCompany && <th className="num">{t('Ở công ty')}</th>}
                <th>{t('Trạng thái')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.product_id}>
                  <td>{row.product_name}</td>
                  {showHome && <td className="num">{row.qty_home}</td>}
                  <td className="num">{row.qty_shop}</td>
                  {hasCompany && <td className="num">{row.qty_company ?? 0}</td>}
                  <td>
                    <span className={`badge badge-${row.status}`}>{t(STATUS_LABEL[row.status])}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
