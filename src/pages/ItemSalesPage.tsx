import { useEffect, useMemo, useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { errorMessage, formatDate, formatVND } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import { applyFilter, categoriesOf, groupByDay, groupItems, isDayRow, mergeByName, reconcile, totalsOf, visibleItems, type ItemGroup, type Mismatch } from '../lib/itemSales'
import { filterItems } from '../lib/itemSales'
import type { MonthlyItemSale } from '../types/database'

const monthLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const fmt = new Intl.NumberFormat('vi-VN')

type Mode = 'month' | 'day'

// Mặt hàng đã bán (số liệu hệ thống tự tổng hợp từ báo cáo POS đã nhập): xem theo tháng hoặc theo ngày, có lọc.
// Cùng khoảng ngày mà doanh thu khác tổng mặt hàng thì cảnh báo.
export function ItemSalesPage() {
  const { current } = useStore()
  return current ? <ItemSales key={current.id} storeId={current.id} /> : null
}

function ItemSales({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const [data, setData] = useState<{ rows: MonthlyItemSale[]; revenue: Map<string, number> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('month')
  const [month, setMonth] = useState<string | null>(null)
  const [filter, setFilter] = useState({ from: '', to: '', category: '', query: '' })
  const [merged, setMerged] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchAll<MonthlyItemSale>((a, b) => supabase.from('monthly_item_sales').select('*').eq('store_id', storeId).order('period_start').order('item_code').range(a, b)),
      fetchAll<{ revenue_date: string; amount: number }>((a, b) => supabase.from('daily_revenue').select('revenue_date, amount').eq('store_id', storeId).neq('channel', 'nem_cuon').order('revenue_date').order('channel').range(a, b)),
    ])
      .then(([rows, daily]) => {
        if (cancelled) return
        const revenue = new Map<string, number>()
        for (const d of daily) revenue.set(d.revenue_date, (revenue.get(d.revenue_date) ?? 0) + Number(d.amount))
        setData({ rows, revenue })
        const firstMonth = rows.find((r) => !isDayRow(r))?.month
        setMonth((m) => m ?? firstMonth ?? null)
        if (!rows.some((r) => !isDayRow(r)) && rows.some(isDayRow)) setMode('day')
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId])

  const view = useMemo(() => {
    if (!data) return null
    const all = data.rows
    const dayRows = all.filter(isDayRow)
    const monthRows = all.filter((r) => !isDayRow(r))
    const months = [...new Set(monthRows.map((r) => r.month))].sort().reverse()
    return { dayRows, monthRows, months }
  }, [data])

  if (error) return <p className="error">{t(error)}</p>
  if (!data || !view) return <p className="muted">{t('Đang tải…')}</p>
  if (data.rows.length === 0) return <p className="muted">{t('Chưa có tổng kết mặt hàng nào. Nhập file báo cáo mặt hàng ở mục Nhập liệu.')}</p>

  const { dayRows, monthRows, months } = view
  const set = (patch: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...patch }))

  // Dòng đang xem (mặt hàng ẩn như nhóm Bún bò không hiện) và dòng dùng để đối chiếu doanh thu (đủ mọi nhóm)
  const scope = useMemo(
    () => (mode === 'month' ? monthRows.filter((r) => r.month === month) : applyFilter(dayRows, { from: filter.from, to: filter.to })),
    [mode, monthRows, month, dayRows, filter.from, filter.to],
  )
  // Gom các dòng trùng tên (nhiều mã POS cho cùng một món) rồi mới lọc nhóm / tìm kiếm
  const unified = useMemo(() => mergeByName(visibleItems(scope)), [scope])
  const categories = useMemo(() => categoriesOf(unified), [unified])
  const mismatches = useMemo(() => reconcile(scope, data.revenue), [scope, data.revenue])
  const shown = useMemo(
    () => (mode === 'month' ? filterItems(applyFilter(unified, { category: filter.category }), filter.query) : applyFilter(unified, { category: filter.category, query: filter.query })),
    [mode, unified, filter.category, filter.query],
  )
  const totals = useMemo(() => totalsOf(shown), [shown])
  const periodEnd = useMemo(() => scope.map((r) => r.period_end).sort().pop(), [scope])
  const pct = (v: number) => (totals.net > 0 ? `${((v / totals.net) * 100).toFixed(1)}%` : '—')
  const days = useMemo(() => (mode === 'day' ? groupByDay(shown) : []), [mode, shown])
  const mismatchOn = (date: string) => mismatches.find((m) => m.start === date)

  return (
    <div className="report-stack">
      <div className="preset-chips" role="group" aria-label={t('Cách xem')}>
        <button type="button" className={mode === 'month' ? 'active' : undefined} disabled={monthRows.length === 0} onClick={() => setMode('month')}>
          {t('Theo tháng')}
        </button>
        <button type="button" className={mode === 'day' ? 'active' : undefined} onClick={() => setMode('day')}>
          {t('Theo ngày')}
        </button>
      </div>

      <div className="filters">
        {mode === 'month' ? (
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
        ) : (
          <>
            <div className="field">
              {t('Từ ngày')}
              <DatePicker value={filter.from} onChange={(v) => set({ from: v })} label={t('Từ ngày')} />
            </div>
            <div className="field">
              {t('Đến ngày')}
              <DatePicker value={filter.to} onChange={(v) => set({ to: v })} label={t('Đến ngày')} />
            </div>
          </>
        )}
        <label>
          {t('Nhóm')}
          <select value={filter.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">{t('Tất cả')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Tìm mặt hàng')}
          <input type="search" value={filter.query} onChange={(e) => set({ query: e.target.value })} placeholder={t('Tên hoặc mã món')} />
        </label>
        {mode === 'day' && (
          <label className="check">
            <input type="checkbox" checked={merged} onChange={(e) => setMerged(e.target.checked)} />
            {t('Gộp các ngày thành một bảng')}
          </label>
        )}
        {(filter.from || filter.to || filter.category || filter.query) && (
          <button type="button" onClick={() => setFilter({ from: '', to: '', category: '', query: '' })}>
            {t('Xoá lọc')}
          </button>
        )}
      </div>

      <Mismatches items={mismatches} />

      {mode === 'day' && dayRows.length === 0 ? (
        <p className="muted">{t('Chưa có số liệu theo ngày. Xuất báo cáo mặt hàng của từng ngày từ máy POS rồi nhập ở mục Nhập liệu → Nhập mặt hàng.')}</p>
      ) : (
        <>
          <section className="report-block">
            <h2>
              {mode === 'month'
                ? t('Mặt hàng đã bán trong tháng {month}', { month: month ? monthLabel(month) : '' })
                : t('Mặt hàng đã bán theo ngày')}
            </h2>
            {mode === 'month' && periodEnd && <p className="muted">{t('Số liệu tính đến hết ngày {date}', { date: formatDate(periodEnd) })}</p>}
            <div className="stats">
              <Stat label={t('Số phần đã bán')} value={fmt.format(totals.qty)} sub={t('{count} mặt hàng', { count: totals.items })} />
              <Stat label={t('Tiền hàng')} value={formatVND(totals.gross)} />
              <Stat label={t('Giảm giá đã cho')} value={formatVND(totals.discount)} />
              <Stat label={t('Doanh thu sau giảm giá')} value={formatVND(totals.net)} />
            </div>
          </section>

          {shown.length === 0 && <p className="muted">{t('Không có mặt hàng nào khớp.')}</p>}

          {mode === 'month' || merged
            ? groupItems(mode === 'month' ? shown : mergeByName(shown, false)).map((g) => <GroupTable key={g.category} group={g} pct={pct} />)
            : days.map((d) => {
                const bad = mismatchOn(d.date)
                return (
                  <section key={d.date} className="report-block">
                    <h2>
                      {formatDate(d.date)}{' '}
                      <small className="muted">
                        · {fmt.format(d.qty)} {t('phần')} · {formatVND(d.net)}
                      </small>{' '}
                      {bad && <span className="badge badge-out">{t('Lệch doanh thu {diff}', { diff: formatVND(Math.abs(bad.diff)) })}</span>}
                    </h2>
                    {d.groups.map((g) => (
                      <GroupTable key={g.category} group={g} pct={(v) => (d.net > 0 ? `${((v / d.net) * 100).toFixed(1)}%` : '—')} />
                    ))}
                  </section>
                )
              })}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

// Cảnh báo: doanh thu cùng khoảng ngày khác tổng mặt hàng
export function Mismatches({ items }: { items: Mismatch[] }) {
  const { t } = useI18n()
  if (items.length === 0) return null
  return (
    <div className="import-warn" role="alert">
      <p>
        <strong>{t('Doanh thu và mặt hàng không khớp nhau ở {count} khoảng ngày:', { count: items.length })}</strong>
      </p>
      <ul className="import-diffs">
        {items.slice(0, 20).map((m) => (
          <li key={`${m.start}|${m.end}`}>
            {m.start === m.end ? formatDate(m.start) : `${formatDate(m.start)} – ${formatDate(m.end)}`}: {t('doanh thu')} {formatVND(m.revenue)} · {t('mặt hàng')} {formatVND(m.items)} ·{' '}
            <strong>{t('chênh {diff}', { diff: `${m.diff > 0 ? '+' : '−'}${formatVND(Math.abs(m.diff))}` })}</strong>
          </li>
        ))}
        {items.length > 20 && <li className="muted">{t('…và {count} dòng khác', { count: items.length - 20 })}</li>}
      </ul>
      <small className="muted">{t('Mặt hàng tính cả nhóm đã ẩn. Có thể do chưa nhập đủ hóa đơn doanh thu hoặc báo cáo mặt hàng của ngày đó.')}</small>
    </div>
  )
}

function GroupTable({ group: g, pct }: { group: ItemGroup; pct: (v: number) => string }) {
  const { t } = useI18n()
  return (
    <section className="report-block">
      <h3>
        {t(g.category)}{' '}
        <small className="muted">
          · {fmt.format(g.qty)} {t('phần')} · {formatVND(g.net)} ({pct(g.net)})
        </small>
      </h3>
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
              <tr key={`${r.id}`}>
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
  )
}
