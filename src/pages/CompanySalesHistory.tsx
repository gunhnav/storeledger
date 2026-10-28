import { useEffect, useMemo, useState } from 'react'
import { PeriodFilters } from '../components/PeriodFilters'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errorMessage, formatDate, formatVND, todayVN } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import { initialPeriod, type PeriodState } from '../lib/period'
import { summarizeCompanySales, type CompanySaleRow } from '../lib/companySalesHistory'

type Loaded = { key: string; sales: CompanySaleRow[]; names: Map<string, string> }

// Lịch sử các đơn bán kênh Công ty theo khoảng ngày chọn (báo cáo của admin Hogi)
export function CompanySalesHistory({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const today = todayVN()
  const [period, setPeriod] = useState<PeriodState>(() => initialPeriod('month', today))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { range } = period
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to
  const key = `${storeId}|${range.from}|${range.to}`

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    Promise.all([
      fetchAll<CompanySaleRow>((a, b) =>
        supabase
          .from('sales')
          .select('id, sale_date, total_amount, discount_amount, note, created_at, sale_items(product_id, quantity, unit_price)')
          .eq('store_id', storeId)
          .eq('channel', 'company')
          .gte('sale_date', range.from)
          .lte('sale_date', range.to)
          .order('sale_date', { ascending: false })
          .order('id')
          .range(a, b),
      ),
      supabase.from('products').select('id, name').eq('store_id', storeId),
    ])
      .then(([sales, products]) => {
        if (cancelled) return
        if (products.error) throw products.error
        setError(null)
        setLoaded({ key, sales, names: new Map((products.data ?? []).map((p) => [p.id, p.name])) })
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId, range, valid, key])

  const data = loaded?.key === key ? loaded : null
  const summary = useMemo(() => (data ? summarizeCompanySales(data.sales) : null), [data])

  let body
  if (!valid) body = <p className="error">{t('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".')}</p>
  else if (error) body = <p className="error">{t(error)}</p>
  else if (!data || !summary) body = <p className="muted">{t('Đang tải…')}</p>
  else if (summary.orders === 0) body = <p className="muted">{t('Chưa có đơn bán cho công ty trong kỳ này.')}</p>
  else
    body = (
      <>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">{t('Doanh thu công ty')}</div>
            <div className="stat-value">{formatVND(summary.revenue)}</div>
            <div className="stat-sub">{t('{count} đơn', { count: summary.orders })}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('Số hũ đã bán')}</div>
            <div className="stat-value">{summary.jars}</div>
          </div>
          {summary.discount > 0 && (
            <div className="stat">
              <div className="stat-label">{t('Tổng giảm giá')}</div>
              <div className="stat-value">{formatVND(summary.discount)}</div>
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Ngày')}</th>
                <th>{t('Đã bán')}</th>
                <th className="num">{t('Số hũ đã bán')}</th>
                <th className="num">{t('Giảm giá')}</th>
                <th className="num">{t('Thành tiền')}</th>
                <th>{t('Ghi chú')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.date)}</td>
                  <td>{l.items.map((i) => `${i.quantity} ${data.names.get(i.productId) ?? ''}`.trim()).join(', ')}</td>
                  <td className="num">{l.jars}</td>
                  <td className="num">{l.discount > 0 ? formatVND(l.discount) : '—'}</td>
                  <td className="num">{formatVND(l.total)}</td>
                  <td>{l.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )

  return (
    <section className="report-block">
      <h2>{t('Lịch sử bán hàng công ty')}</h2>
      <PeriodFilters value={period} today={today} onChange={setPeriod} />
      {body}
    </section>
  )
}
