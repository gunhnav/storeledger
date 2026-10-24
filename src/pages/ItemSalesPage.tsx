import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { errorMessage, formatDate, formatVND } from '../lib/format'
import { filterItems, groupItems, totalsOf } from '../lib/itemSales'
import type { MonthlyItemSale } from '../types/database'

const monthLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const fmt = new Intl.NumberFormat('vi-VN')

// Tổng kết mặt hàng bán theo tháng (chỉ admin, quán Bún đậu): nhóm, số phần, tiền hàng, giảm giá, doanh thu, tỷ trọng.
export function ItemSalesPage() {
  const { current } = useStore()
  return current ? <ItemSales key={current.id} storeId={current.id} /> : null
}

function ItemSales({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<MonthlyItemSale[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('monthly_item_sales')
      .select('*')
      .eq('store_id', storeId)
      .order('month', { ascending: false })
      .limit(5000)
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) return setError(errorMessage(e))
        setRows(data)
        setMonth((m) => m ?? data[0]?.month ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (error) return <p className="error">{t(error)}</p>
  if (!rows) return <p className="muted">{t('Đang tải…')}</p>
  if (rows.length === 0) return <p className="muted">{t('Chưa có tổng kết mặt hàng nào.')}</p>

  const months = [...new Set(rows.map((r) => r.month))]
  const ofMonth = rows.filter((r) => r.month === month)
  const totals = totalsOf(ofMonth)
  const groups = groupItems(filterItems(ofMonth, query))
  const periodEnd = ofMonth[0]?.period_end
  const pct = (v: number) => (totals.net > 0 ? `${((v / totals.net) * 100).toFixed(1)}%` : '—')

  return (
    <div className="report-stack">
      <div className="filters">
        <label>
          {t('Tháng')}
          <select value={month ?? ''} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Tìm mặt hàng')}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Tên hoặc mã món')} />
        </label>
      </div>

      <section className="report-block">
        <h2>{t('Mặt hàng đã bán trong tháng {month}', { month: month ? monthLabel(month) : '' })}</h2>
        {periodEnd && <p className="muted">{t('Số liệu tính đến hết ngày {date}', { date: formatDate(periodEnd) })}</p>}
        <div className="stats">
          <div className="stat">
            <div className="stat-label">{t('Số phần đã bán')}</div>
            <div className="stat-value">{fmt.format(totals.qty)}</div>
            <div className="stat-sub">{t('{count} mặt hàng', { count: totals.items })}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('Tiền hàng')}</div>
            <div className="stat-value">{formatVND(totals.gross)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('Giảm giá đã cho')}</div>
            <div className="stat-value">{formatVND(totals.discount)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('Doanh thu sau giảm giá')}</div>
            <div className="stat-value">{formatVND(totals.net)}</div>
          </div>
        </div>
      </section>

      {groups.length === 0 && <p className="muted">{t('Không có mặt hàng nào khớp.')}</p>}
      {groups.map((g) => (
        <section key={g.category} className="report-block">
          <h2>
            {t(g.category)} <small className="muted">· {fmt.format(g.qty)} {t('phần')} · {formatVND(g.net)} ({pct(g.net)})</small>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Mặt hàng')}</th>
                  <th className="num">{t('Số phần')}</th>
                  <th className="num">{t('Tiền hàng')}</th>
                  <th className="num">{t('Giảm giá')}</th>
                  <th className="num">{t('Doanh thu')}</th>
                  <th className="num">{t('Tỷ trọng')}</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.item_name} <small className="muted">{r.item_code}</small>
                    </td>
                    <td className="num">{fmt.format(Number(r.qty))}</td>
                    <td className="num">{formatVND(Number(r.gross))}</td>
                    <td className="num">{Number(r.discount) > 0 ? formatVND(Number(r.discount)) : '—'}</td>
                    <td className="num">{formatVND(Number(r.net))}</td>
                    <td className="num">{pct(Number(r.net))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
