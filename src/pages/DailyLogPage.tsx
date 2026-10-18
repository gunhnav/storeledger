import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import {
  addDays,
  errorMessage,
  formatCompact,
  formatDate,
  formatVND,
  monthEnd,
  monthStart,
  todayVN,
} from '../lib/format'
import type { DailyProductLogRow, DailySummaryRow } from '../types/database'

// Một ô của bảng: số lượng, tiền hoặc chữ; tone để tô màu
type Tone = 'out' | 'low' | 'neg' | 'ok'
type Cell = { value: number | string | null; tone?: Tone }
type Row =
  | { kind: 'section'; label: string }
  | { kind: 'data'; label: string; format: 'qty' | 'money' | 'text'; total: Cell; cells: Cell[]; sub?: string }

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function weekday(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]
}

function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

export function DailyLogPage() {
  const { current } = useStore()
  // Đổi cửa hàng thì dựng lại để tải lại dữ liệu
  return current ? <DailyLog key={current.id} storeId={current.id} storeName={current.name} /> : null
}

// Chỉ admin (route bọc RequireAdmin, hàm DB cũng chặn)
function DailyLog({ storeId, storeName }: { storeId: string; storeName: string }) {
  const today = todayVN()
  const [range, setRange] = useState({ from: monthStart(today), to: today })
  const [category, setCategory] = useState('')
  const [result, setResult] = useState<{
    key: string
    summary: DailySummaryRow[]
    products: DailyProductLogRow[]
    error: string | null
  } | null>(null)

  // Ngày tương lai không hiện: chặn "đến ngày" ở hôm nay
  const to = range.to > today ? today : range.to
  const valid = range.from !== '' && to !== '' && range.from <= to
  const tooLong = valid && addDays(range.from, 365) < to
  const key = `${range.from}|${to}`

  useEffect(() => {
    if (!valid || tooLong) return
    let cancelled = false
    const args = { p_store_id: storeId, p_from: range.from, p_to: to }
    Promise.all([
      supabase.rpc('get_daily_summary', args),
      supabase.rpc('get_daily_product_log', args),
    ]).then(([summary, products]) => {
      if (cancelled) return
      const error = summary.error ?? products.error
      setResult({
        key,
        summary: summary.data ?? [],
        products: products.data ?? [],
        error: error ? errorMessage(error) : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, range.from, to, valid, tooLong, key])

  const loaded = result && result.key === key ? result : null
  const days = loaded?.summary.map((r) => r.day) ?? []
  const rows = loaded ? buildRows(loaded.summary, loaded.products, days, category) : []
  const categories = loaded
    ? [...new Set(loaded.products.map((p) => p.category ?? '').filter((c) => c !== ''))].sort()
    : []
  const hasActivity =
    !!loaded &&
    (loaded.summary.some(
      (r) => r.qty_sold > 0 || r.expenses > 0 || r.purchase_cost > 0 || r.price_notes !== null,
    ) ||
      loaded.products.some((p) => p.qty_transferred > 0))

  const downloadCsv = () => {
    const header = ['Hạng mục', 'TỔNG', ...days.map((d) => `${weekday(d)} ${formatDate(d)}`)]
    const lines = [header]
    for (const row of rows) {
      if (row.kind === 'section') lines.push([row.label])
      else lines.push([row.label, csvValue(row.total), ...row.cells.map(csvValue)])
    }
    const csv = lines.map((cols) => cols.map(csvQuote).join(',')).join('\r\n')
    // BOM để Excel / Google Sheets đọc đúng tiếng Việt
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nhat-ky-${storeName}-${range.from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section>
      <div className="card log-filters">
        <label className="field">
          Từ ngày
          <input
            type="date"
            max={today}
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </label>
        <label className="field">
          Đến ngày
          <input
            type="date"
            max={today}
            value={to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </label>
        <div className="log-quick">
          <button type="button" onClick={() => setRange({ from: addDays(today, -6), to: today })}>
            7 ngày
          </button>
          <button type="button" onClick={() => setRange({ from: monthStart(today), to: today })}>
            Tháng này
          </button>
          <button
            type="button"
            onClick={() => setRange({ from: monthStart(today, -1), to: monthEnd(today, -1) })}
          >
            Tháng trước
          </button>
        </div>
        {categories.length > 1 && (
          <label className="field">
            Nhóm (khối Bán trong ngày)
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Tất cả</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <button type="button" className="primary" onClick={downloadCsv} disabled={!loaded || !!loaded.error}>
          Tải CSV
        </button>
      </div>

      {!valid ? (
        <p className="error">Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".</p>
      ) : tooLong ? (
        <p className="error">Khoảng ngày tối đa 366 ngày.</p>
      ) : !loaded ? (
        <p className="muted">Đang tải…</p>
      ) : loaded.error ? (
        <p className="error">{loaded.error}</p>
      ) : !hasActivity ? (
        <p className="pos-empty muted">
          Chưa có giao dịch trong khoảng này. Khi có nhập hàng, chuyển hàng, bán hàng hoặc chi phí, nhật ký
          sẽ hiện ở đây theo từng ngày.
        </p>
      ) : (
        <div className="table-wrap log-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th className="sticky-col">Hạng mục</th>
                <th className="num total-col">TỔNG</th>
                {days.map((d) => (
                  <th key={d} className={`num${weekday(d) === 'CN' ? ' sunday' : ''}`}>
                    <span className="day-label">{dayMonth(d)}</span>
                    <span className="weekday">{weekday(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) =>
                row.kind === 'section' ? (
                  <tr key={i} className="log-section">
                    <td className="sticky-col">{row.label}</td>
                    <td colSpan={days.length + 1} />
                  </tr>
                ) : (
                  <tr key={i} className={row.format === 'text' ? 'log-text-row' : undefined}>
                    <td className="sticky-col">
                      {row.label}
                      {row.sub && <small className="muted"> {row.sub}</small>}
                    </td>
                    <LogCell cell={row.total} format={row.format} total />
                    {row.cells.map((cell, j) => (
                      <LogCell key={j} cell={cell} format={row.format} />
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function LogCell({ cell, format, total }: { cell: Cell; format: 'qty' | 'money' | 'text'; total?: boolean }) {
  const className = [format === 'text' ? 'log-text' : 'num', total ? 'total-col' : '', cell.tone ? `tone-${cell.tone}` : '']
    .filter(Boolean)
    .join(' ')
  if (cell.value === null || cell.value === '') return <td className={className} />
  if (typeof cell.value === 'string') return <td className={className}>{cell.value}</td>
  if (format === 'money') {
    return (
      <td className={className} title={formatVND(cell.value)}>
        {cell.value === 0 ? <span className="zero">0</span> : formatCompact(cell.value)}
      </td>
    )
  }
  return <td className={className}>{cell.value === 0 ? <span className="zero">0</span> : cell.value}</td>
}

// Dựng các khối của bảng theo mẫu Google Sheet; chỉ cộng các dòng RPC trả về
function buildRows(
  summary: DailySummaryRow[],
  products: DailyProductLogRow[],
  days: string[],
  category: string,
): Row[] {
  const rows: Row[] = []
  const byProduct = new Map<string, { name: string; category: string | null; tracks: boolean; threshold: number; byDay: Map<string, DailyProductLogRow> }>()
  for (const p of products) {
    let entry = byProduct.get(p.product_id)
    if (!entry) {
      entry = { name: p.product_name, category: p.category, tracks: p.tracks_stock, threshold: p.low_stock_threshold, byDay: new Map() }
      byProduct.set(p.product_id, entry)
    }
    entry.byDay.set(p.day, p)
  }
  const all = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const stocked = all.filter((p) => p.tracks)
  const lastDay = days[days.length - 1]

  const qtyRow = (label: string, values: number[], sub?: string): Row => ({
    kind: 'data',
    label,
    sub,
    format: 'qty',
    total: { value: sum(values) },
    cells: values.map((v) => ({ value: v })),
  })
  const moneyRow = (label: string, values: number[], totalValue = sum(values)): Row => ({
    kind: 'data',
    label,
    format: 'money',
    total: { value: totalValue, tone: totalValue < 0 ? 'neg' : undefined },
    cells: values.map((v) => ({ value: v, tone: v < 0 ? 'neg' : undefined })),
  })

  // Khối 1: MANG RA QUÁN
  if (stocked.length > 0) {
    rows.push({ kind: 'section', label: 'MANG RA QUÁN' })
    for (const p of stocked) rows.push(qtyRow(p.name, days.map((d) => p.byDay.get(d)?.qty_transferred ?? 0)))
  }

  // Khối 2: BÁN TRONG NGÀY (chỉ món có bán trong khoảng)
  const sold = all.filter(
    (p) =>
      (category === '' || p.category === category) &&
      [...p.byDay.values()].some((r) => r.qty_sold > 0),
  )
  rows.push({ kind: 'section', label: 'BÁN TRONG NGÀY' })
  if (sold.length === 0) {
    rows.push({ kind: 'data', label: 'Chưa bán món nào', format: 'text', total: { value: null }, cells: days.map(() => ({ value: null })) })
  }
  for (const p of sold) rows.push(qtyRow(p.name, days.map((d) => p.byDay.get(d)?.qty_sold ?? 0)))

  // Khối 3: KẾT QUẢ NGÀY
  rows.push({ kind: 'section', label: 'KẾT QUẢ NGÀY' })
  rows.push(qtyRow('Tổng số lượng bán', summary.map((r) => r.qty_sold)))
  rows.push(moneyRow('Doanh thu gộp', summary.map((r) => r.gross_revenue)))
  rows.push(moneyRow('Hoa hồng ShopeeFood', summary.map((r) => r.commission)))
  rows.push(moneyRow('Doanh thu thuần', summary.map((r) => r.net_revenue)))
  rows.push(moneyRow('Chi phí', summary.map((r) => r.expenses)))
  rows.push(moneyRow('Giá vốn hàng bán', summary.map((r) => r.cogs)))
  rows.push(moneyRow('Lãi gộp', summary.map((r) => r.gross_profit)))
  rows.push(moneyRow('Lãi sau chi phí', summary.map((r) => r.net_profit)))

  if (stocked.length > 0) {
    // Khối 4: CÒN TẠI QUÁN (cột TỔNG = cuối kỳ)
    rows.push({ kind: 'section', label: 'CÒN TẠI QUÁN (cuối ngày)' })
    const shopTone = (v: number, threshold: number): Tone | undefined =>
      v <= 0 ? 'out' : v <= threshold ? 'low' : undefined
    for (const p of stocked) {
      const values = days.map((d) => p.byDay.get(d)?.shop_end ?? 0)
      const end = p.byDay.get(lastDay)?.shop_end ?? 0
      rows.push({
        kind: 'data',
        label: p.name,
        format: 'qty',
        total: { value: end, tone: shopTone(end, p.threshold) },
        cells: values.map((v) => ({ value: v, tone: shopTone(v, p.threshold) })),
      })
    }
    rows.push({
      kind: 'data',
      label: '⚠ Cảnh báo',
      format: 'text',
      total: { value: null },
      cells: days.map((d) => {
        const out = stocked.filter((p) => (p.byDay.get(d)?.shop_end ?? 0) <= 0).map((p) => p.name)
        return { value: out.length > 0 ? `Hết: ${out.join(', ')}` : null, tone: out.length > 0 ? 'out' : undefined }
      }),
    })

    // Khối 5: CÒN Ở NHÀ
    rows.push({ kind: 'section', label: 'CÒN Ở NHÀ (cuối ngày)' })
    for (const p of stocked) {
      const cell = (v: number): Cell => (v <= 0 ? { value: 'cần nhập thêm', tone: 'out' } : { value: v })
      rows.push({
        kind: 'data',
        label: p.name,
        format: 'qty',
        total: cell(p.byDay.get(lastDay)?.home_end ?? 0),
        cells: days.map((d) => cell(p.byDay.get(d)?.home_end ?? 0)),
      })
    }
  }

  // Khối 6: VỐN & HOÀ VỐN (luỹ kế: cột TỔNG = cuối kỳ)
  const last = summary[summary.length - 1]
  rows.push({ kind: 'section', label: 'VỐN & HOÀ VỐN' })
  rows.push(moneyRow('Tiền nhập hàng trong ngày', summary.map((r) => r.purchase_cost)))
  rows.push(moneyRow('Vốn đã chi luỹ kế', summary.map((r) => r.cum_invested), last?.cum_invested ?? 0))
  rows.push(moneyRow('Doanh thu thuần luỹ kế', summary.map((r) => r.cum_net_revenue), last?.cum_net_revenue ?? 0))
  rows.push(moneyRow('Dòng tiền ròng luỹ kế', summary.map((r) => r.cum_cash_flow), last?.cum_cash_flow ?? 0))
  rows.push({
    kind: 'data',
    label: 'Đã hoà vốn?',
    format: 'text',
    total: { value: last?.is_break_even ? '✔' : '—', tone: last?.is_break_even ? 'ok' : undefined },
    cells: summary.map((r) => ({ value: r.is_break_even ? '✔' : '—', tone: r.is_break_even ? 'ok' : undefined })),
  })

  // Khối 7: GHI CHÚ ĐỔI GIÁ
  if (summary.some((r) => r.price_notes)) {
    rows.push({ kind: 'section', label: 'GHI CHÚ ĐỔI GIÁ' })
    rows.push({
      kind: 'data',
      label: 'Đổi giá',
      format: 'text',
      total: { value: null },
      cells: summary.map((r) => ({ value: r.price_notes })),
    })
  }

  return rows
}

// CSV: số để nguyên (không rút gọn) để tính toán được trong Excel / Sheets
function csvValue(cell: Cell): string {
  return cell.value === null ? '' : String(cell.value)
}

function csvQuote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
