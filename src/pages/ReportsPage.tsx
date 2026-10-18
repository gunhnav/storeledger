import { useEffect, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { errorMessage, formatDate, formatVND, todayVN } from '../lib/format'
import type { BreakEvenRow, PnlPeriod, PnlRow } from '../types/database'

export function ReportsPage() {
  const { current } = useStore()
  // Đổi cửa hàng thì dựng lại cả hai khối để tải lại dữ liệu
  return current ? <Reports key={current.id} storeId={current.id} /> : null
}

function Reports({ storeId }: { storeId: string }) {
  return (
    <>
      <BreakEvenBlock storeId={storeId} />
      <PnlBlock storeId={storeId} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Ngày tháng: làm việc trên chuỗi 'YYYY-MM-DD' theo UTC để không lệch múi giờ
// ---------------------------------------------------------------------------

function toISO(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m - 1, d]
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso)
  return toISO(Date.UTC(y, m, d + days))
}

// Ngày đầu / cuối tháng, lệch `offset` tháng so với tháng chứa `iso`
function monthStart(iso: string, offset = 0): string {
  const [y, m] = parts(iso)
  return toISO(Date.UTC(y, m + offset, 1))
}

function monthEnd(iso: string, offset = 0): string {
  const [y, m] = parts(iso)
  return toISO(Date.UTC(y, m + offset + 1, 0))
}

// Thứ Hai của tuần chứa `iso` (khớp date_trunc('week') trong DB)
function mondayOf(iso: string): string {
  const [y, m, d] = parts(iso)
  const weekday = new Date(Date.UTC(y, m, d)).getUTCDay()
  return addDays(iso, -((weekday + 6) % 7))
}

// Ngày: 30 ngày gần nhất · Tuần: 12 tuần · Tháng: 6 tháng
function defaultRange(period: PnlPeriod): { from: string; to: string } {
  const today = todayVN()
  if (period === 'day') return { from: addDays(today, -29), to: today }
  if (period === 'week') return { from: addDays(mondayOf(today), -7 * 11), to: today }
  return { from: monthStart(today, -5), to: today }
}

function periodLabel(iso: string, period: PnlPeriod): string {
  const [y, m, d] = iso.split('-')
  if (period === 'day') return `${d}/${m}`
  if (period === 'week') return `Tuần ${d}/${m}`
  return `${m}/${y}`
}

const compact = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

// Trục Y rút gọn: 1,2tr · 350k · 2,5 tỷ
function formatCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${compact.format(value / 1e9)} tỷ`
  if (abs >= 1e6) return `${compact.format(value / 1e6)}tr`
  if (abs >= 1e3) return `${compact.format(value / 1e3)}k`
  return compact.format(value)
}

const percent = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

// ---------------------------------------------------------------------------
// Điểm hoà vốn
// ---------------------------------------------------------------------------

function BreakEvenBlock({ storeId }: { storeId: string }) {
  const [result, setResult] = useState<{ row: BreakEvenRow | null; error: string | null } | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_break_even', { p_store_id: storeId }).then(({ data, error }) => {
      if (cancelled) return
      setResult({ row: data?.[0] ?? null, error: error ? errorMessage(error) : null })
    })
    return () => {
      cancelled = true
    }
  }, [storeId])

  return (
    <section className="report-block">
      <h2>Điểm hoà vốn</h2>
      {!result ? (
        <p className="muted">Đang tải…</p>
      ) : result.error ? (
        <p className="error">{result.error}</p>
      ) : !result.row ||
        (result.row.total_invested === 0 && result.row.cumulative_net_revenue === 0) ? (
        <p className="muted">
          Chưa có dữ liệu. Khi có nhập hàng, chi phí hoặc đơn bán, tiến độ thu hồi vốn sẽ hiện ở đây.
        </p>
      ) : (
        <BreakEvenSummary row={result.row} />
      )}
    </section>
  )
}

function BreakEvenSummary({ row }: { row: BreakEvenRow }) {
  const pct = row.pct_recovered
  const width = pct === null ? 0 : Math.min(Math.max(pct, 0), 100)

  let status: string
  if (row.total_invested === 0) {
    status = 'Chưa có nhập hàng hay chi phí nên chưa tính được điểm hoà vốn.'
  } else if (row.break_even_date) {
    status = `Đã hoà vốn ngày ${formatDate(row.break_even_date)}.`
  } else if (row.avg_daily_net_revenue > 0) {
    const days = Math.ceil(row.shortfall / row.avg_daily_net_revenue)
    status =
      `Dự kiến hoà vốn sau khoảng ${days} ngày ` +
      `(ước tính theo doanh thu thuần bình quân ${formatVND(row.avg_daily_net_revenue)}/ngày).`
  } else {
    status = 'Chưa có doanh thu nên chưa ước tính được ngày hoà vốn.'
  }

  return (
    <>
      {pct !== null && (
        <>
          <p>
            Đã thu hồi <strong>{percent.format(pct)}%</strong> vốn
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-label="Tiến độ thu hồi vốn"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={width}
          >
            <div className="progress-bar" style={{ width: `${width}%` }} />
          </div>
        </>
      )}
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Vốn đầu tư</div>
          <div className="stat-value">{formatVND(row.total_invested)}</div>
          <div className="stat-sub">
            Nhập hàng {formatVND(row.total_purchase_cost)} + chi phí {formatVND(row.total_expenses)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Doanh thu thuần luỹ kế</div>
          <div className="stat-value">{formatVND(row.cumulative_net_revenue)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Còn thiếu</div>
          <div className="stat-value">{formatVND(row.shortfall)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Giá trị hàng tồn</div>
          <div className="stat-value">{formatVND(row.remaining_stock_value)}</div>
        </div>
      </div>
      <p>{status}</p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Lãi lỗ theo kỳ
// ---------------------------------------------------------------------------

type Totals = Omit<PnlRow, 'period_start'>

const TOTAL_FIELDS: { key: keyof Totals; label: string }[] = [
  { key: 'gross_revenue', label: 'Doanh thu gộp' },
  { key: 'commission', label: 'Hoa hồng' },
  { key: 'net_revenue', label: 'Doanh thu thuần' },
  { key: 'cogs', label: 'Giá vốn' },
  { key: 'gross_profit', label: 'Lãi gộp' },
  { key: 'expenses', label: 'Chi phí' },
  { key: 'net_profit', label: 'Lãi ròng' },
]

function sumRows(rows: PnlRow[]): Totals {
  const totals: Totals = {
    gross_revenue: 0,
    commission: 0,
    net_revenue: 0,
    cogs: 0,
    gross_profit: 0,
    expenses: 0,
    net_profit: 0,
  }
  for (const row of rows) {
    for (const { key } of TOTAL_FIELDS) totals[key] += row[key]
  }
  return totals
}

function PnlBlock({ storeId }: { storeId: string }) {
  const [period, setPeriod] = useState<PnlPeriod>('day')
  const [range, setRange] = useState(() => defaultRange('day'))
  const [result, setResult] = useState<{
    key: string
    rows: PnlRow[]
    error: string | null
  } | null>(null)

  const valid = range.from !== '' && range.to !== '' && range.from <= range.to
  const key = `${period}|${range.from}|${range.to}`

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    supabase
      .rpc('get_pnl', { p_store_id: storeId, p_period: period, p_from: range.from, p_to: range.to })
      .then(({ data, error }) => {
        if (cancelled) return
        setResult({ key, rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, period, range.from, range.to, valid, key])

  const changePeriod = (next: PnlPeriod) => {
    setPeriod(next)
    setRange(defaultRange(next))
  }

  const today = todayVN()

  return (
    <section className="report-block">
      <h2>Lãi lỗ</h2>
      <div className="filters">
        <label>
          Kỳ
          <select value={period} onChange={(e) => changePeriod(e.target.value as PnlPeriod)}>
            <option value="day">Ngày</option>
            <option value="week">Tuần</option>
            <option value="month">Tháng</option>
          </select>
        </label>
        <label>
          Từ ngày
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </label>
        <label>
          Đến ngày
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </label>
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

      {!valid ? (
        <p className="error">Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".</p>
      ) : !result || result.key !== key ? (
        <p className="muted">Đang tải…</p>
      ) : result.error ? (
        <p className="error">{result.error}</p>
      ) : result.rows.length === 0 ? (
        <p className="muted">Chưa có giao dịch trong khoảng này.</p>
      ) : (
        <PnlDetails rows={result.rows} period={period} />
      )}
    </section>
  )
}

function PnlDetails({ rows, period }: { rows: PnlRow[]; period: PnlPeriod }) {
  const totals = sumRows(rows)
  const chartData = rows.map((r) => ({
    label: periodLabel(r.period_start, period),
    net_revenue: r.net_revenue,
    cost: r.cogs + r.expenses,
    net_profit: r.net_profit,
  }))
  const hasLoss = rows.some((r) => r.net_profit < 0)

  return (
    <>
      <div className="stats">
        {TOTAL_FIELDS.map(({ key, label }) => (
          <div className="stat" key={key}>
            <div className="stat-label">{label}</div>
            <div
              className={`stat-value${key === 'net_profit' && totals[key] < 0 ? ' negative' : ''}`}
            >
              {formatVND(totals[key])}
            </div>
          </div>
        ))}
      </div>

      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              stroke="var(--border)"
              tickLine={false}
              minTickGap={8}
            />
            <YAxis
              tickFormatter={formatCompact}
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              stroke="var(--border)"
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              formatter={(value) => formatVND(Number(value))}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
              labelStyle={{ color: 'var(--text-h)', fontWeight: 600 }}
              itemStyle={{ color: 'var(--text)' }}
              cursor={{ fill: 'var(--border)', fillOpacity: 0.4 }}
            />
            <Legend wrapperStyle={{ fontSize: 13, color: 'var(--text)' }} />
            {hasLoss && <ReferenceLine y={0} stroke="var(--muted)" />}
            <Bar
              dataKey="net_revenue"
              name="Doanh thu thuần"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="cost"
              name="Giá vốn + chi phí"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Line
              dataKey="net_profit"
              name="Lãi ròng"
              type="monotone"
              stroke="var(--chart-3)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--chart-3)', stroke: 'var(--surface)', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kỳ</th>
              {TOTAL_FIELDS.map(({ key, label }) => (
                <th key={key} className="num">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period_start}>
                <td>
                  {period === 'day' ? formatDate(row.period_start) : periodLabel(row.period_start, period)}
                </td>
                {TOTAL_FIELDS.map(({ key }) => (
                  <td
                    key={key}
                    className={`num${key === 'net_profit' && row[key] < 0 ? ' negative' : ''}`}
                  >
                    {formatVND(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
