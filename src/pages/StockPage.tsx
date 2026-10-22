import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { StockAlertBanner } from '../components/StockAlertBanner'
import { useStockAlerts } from '../lib/useStockAlerts'
import { errorMessage } from '../lib/format'
import { usesDistribution, usesIngredients } from '../lib/storeFeatures'
import { ingredientStatus } from '../lib/ingredients'
import { IngredientStockTable } from '../components/IngredientStockTable'
import type { IngredientStockRow, StockStatus, StockStatusRow } from '../types/database'

const RECENT_DAYS = 7

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
  // Quán có nguyên liệu (Bún đậu): tồn nguyên liệu tính theo doanh thu × công thức
  const hasIngredients = usesIngredients(current?.code)
  const [ingredients, setIngredients] = useState<{ storeId: string; rows: IngredientStockRow[] } | null>(null)

  useEffect(() => {
    if (!storeId || !hasIngredients) return
    let cancelled = false
    supabase.rpc('get_ingredient_stock', { p_store_id: storeId, p_recent_days: RECENT_DAYS }).then(({ data }) => {
      if (!cancelled) setIngredients({ storeId, rows: data ?? [] })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, hasIngredients])

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

  const ingredientRows = hasIngredients && ingredients?.storeId === storeId ? ingredients.rows : []
  // Banner gộp thêm nguyên liệu hết / sắp hết
  const ingOut = ingredientRows.filter((g) => ['out', 'check'].includes(ingredientStatus(g.on_hand, g.low_stock_threshold))).map((g) => g.name)
  const ingLow = ingredientRows.filter((g) => ingredientStatus(g.on_hand, g.low_stock_threshold) === 'low').map((g) => g.name)
  const banner = alerts
    ? {
        ...alerts,
        out: [...alerts.out, ...ingOut],
        low: [...alerts.low, ...ingLow],
        level: alerts.out.length + alerts.check.length + ingOut.length ? ('red' as const) : alerts.low.length + ingLow.length ? ('orange' as const) : ('green' as const),
      }
    : null

  return (
    <section>
      {banner && <StockAlertBanner alerts={banner} restock={!showHome} />}
      {hasIngredients && <h2>{t('Đồ uống')}</h2>}
      {result.rows.length === 0 ? (
        <p className="muted">{t('Chưa có sản phẩm nào quản lý tồn kho.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Sản phẩm')}</th>
                {showHome && <th className="num">{t('Nhà')}</th>}
                <th className="num">{t('Quán')}</th>
                {hasCompany && <th className="num">{t('Công ty')}</th>}
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
      {hasIngredients && (
        <>
          <h2>{t('Nguyên liệu')}</h2>
          {!ingredients || ingredients.storeId !== storeId ? (
            <p className="muted">{t('Đang tải…')}</p>
          ) : ingredientRows.length === 0 ? (
            <p className="muted">{t('Chưa có nguyên liệu nào. Thêm ở Quản lý → Nguyên liệu, nhập ở Kho hàng → Nhập hàng.')}</p>
          ) : (
            <>
              <IngredientStockTable rows={ingredientRows} recentDays={RECENT_DAYS} />
              <small className="muted">{t('Còn lại = tổng nhập - số phần món đã bán × định lượng trong công thức.')}</small>
            </>
          )}
        </>
      )}
    </section>
  )
}
