import { useEffect, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { LANGUAGES, useI18n, type Translate } from '../lib/i18n'
import { useStore } from '../lib/store'
import { usesPartnerChannel } from '../lib/storeFeatures'
import { OverviewExtras } from './OverviewExtras'
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
import type { BreakEvenRow, PnlPeriod, PnlRow } from '../types/database'

export function ReportsPage() {
  const { current } = useStore()
  // Đổi cửa hàng thì dựng lại cả hai khối để tải lại dữ liệu
  return current ? <Reports key={current.id} storeId={current.id} /> : null
}

function Reports({ storeId }: { storeId: string }) {
  return (
    <>
      <OverviewExtras storeId={storeId} />
      <BreakEvenBlock storeId={storeId} />
      <PnlBlock storeId={storeId} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Ngày tháng: làm việc trên chuỗi 'YYYY-MM-DD' theo UTC để không lệch múi giờ
// ---------------------------------------------------------------------------

// Thứ Hai của tuần chứa `iso` (khớp date_trunc('week') trong DB)
function mondayOf(iso: string): string {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return addDays(iso, -((weekday + 6) % 7))
}

// Ngày: 30 ngày gần nhất · Tuần: 12 tuần · Tháng: 6 tháng
function defaultRange(period: PnlPeriod): { from: string; to: string } {
  const today = todayVN()
  if (period === 'day') return { from: addDays(today, -29), to: today }
  if (period === 'week') return { from: addDays(mondayOf(today), -7 * 11), to: today }
  return { from: monthStart(today, -5), to: today }
}

function periodLabel(iso: string, period: PnlPeriod, t: Translate): string {
  const [y, m, d] = iso.split('-')
  if (period === 'day') return `${d}/${m}`
  if (period === 'week') return t('Tuần {date}', { date: `${d}/${m}` })
  return `${m}/${y}`
}

const percent = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

// ---------------------------------------------------------------------------
// Điểm hoà vốn
// ---------------------------------------------------------------------------

function BreakEvenBlock({ storeId }: { storeId: string }) {
  const { t } = useI18n()
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
      <h2>{t('Điểm hoà vốn')}</h2>
      {!result ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : result.error ? (
        <p className="error">{t(result.error)}</p>
      ) : !result.row ||
        (result.row.total_invested === 0 && result.row.cumulative_net_revenue === 0) ? (
        <p className="muted">
          {t('Chưa có dữ liệu. Khi có nhập hàng, chi phí hoặc đơn bán, tiến độ thu hồi vốn sẽ hiện ở đây.')}
        </p>
      ) : (
        <BreakEvenSummary row={result.row} />
      )}
    </section>
  )
}

function BreakEvenSummary({ row }: { row: BreakEvenRow }) {
  const { t } = useI18n()
  const pct = row.pct_recovered
  const width = pct === null ? 0 : Math.min(Math.max(pct, 0), 100)

  let status: string
  if (row.total_invested === 0) {
    status = t('Chưa có nhập hàng hay chi phí nên chưa tính được điểm hoà vốn.')
  } else if (row.break_even_date) {
    status = t('Đã hoà vốn ngày {value}.', { value: formatDate(row.break_even_date) })
  } else if (row.avg_daily_net_revenue > 0) {
    const days = Math.ceil(row.shortfall / row.avg_daily_net_revenue)
    status = t(
      'Dự kiến hoà vốn sau khoảng {days} ngày (ước tính theo doanh thu thuần bình quân {amount}/ngày).',
      { days, amount: formatVND(row.avg_daily_net_revenue) },
    )
  } else {
    status = t('Chưa có doanh thu nên chưa ước tính được ngày hoà vốn.')
  }

  return (
    <>
      {pct !== null && (
        <>
          <p>
            {t('Đã thu hồi {pct}% vốn', { pct: percent.format(pct) })}
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-label={t('Tiến độ thu hồi vốn')}
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
          <div className="stat-label">{t('Vốn đầu tư')}</div>
          <div className="stat-value">{formatVND(row.total_invested)}</div>
          <div className="stat-sub">
            {t('Nhập hàng {purchase} + chi phí {expenses}', {
              purchase: formatVND(row.total_purchase_cost),
              expenses: formatVND(row.total_expenses),
            })}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('Doanh thu thuần luỹ kế')}</div>
          <div className="stat-value">{formatVND(row.cumulative_net_revenue)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('Còn thiếu')}</div>
          <div className="stat-value">{formatVND(row.shortfall)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('Giá trị hàng tồn')}</div>
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
  const { t } = useI18n()
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
      <h2>{t('Lãi lỗ')}</h2>
      <div className="filters">
        <label>
          {t('Kỳ')}
          <select value={period} onChange={(e) => changePeriod(e.target.value as PnlPeriod)}>
            <option value="day">{t('Ngày')}</option>
            <option value="week">{t('Tuần')}</option>
            <option value="month">{t('Tháng')}</option>
          </select>
        </label>
        <div className="field">
          {t('Từ ngày')}
          <DatePicker value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} label={t('Từ ngày')} />
        </div>
        <div className="field">
          {t('Đến ngày')}
          <DatePicker value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} label={t('Đến ngày')} />
        </div>
        <button type="button" onClick={() => setRange({ from: monthStart(today), to: today })}>
          {t('Tháng này')}
        </button>
        <button
          type="button"
          onClick={() => setRange({ from: monthStart(today, -1), to: monthEnd(today, -1) })}
        >
          {t('Tháng trước')}
        </button>
      </div>

      {!valid ? (
        <p className="error">{t('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".')}</p>
      ) : !result || result.key !== key ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : result.error ? (
        <p className="error">{t(result.error)}</p>
      ) : result.rows.length === 0 ? (
        <p className="muted">{t('Chưa có giao dịch trong khoảng này.')}</p>
      ) : (
        <PnlDetails rows={result.rows} period={period} />
      )}
    </section>
  )
}

function PnlDetails({ rows, period }: { rows: PnlRow[]; period: PnlPeriod }) {
  const { t, lang } = useI18n()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const totals = sumRows(rows)
  // Hoa hồng chỉ hiện ở quán có kênh đối tác, hoặc khi dữ liệu thật sự có hoa hồng (đơn cũ)
  const { current } = useStore()
  const showCommission = usesPartnerChannel(current?.code) || totals.commission !== 0
  const fields = TOTAL_FIELDS.filter((f) => f.key !== 'commission' || showCommission)
  const chartData = rows.map((r) => ({
    label: periodLabel(r.period_start, period, t),
    net_revenue: r.net_revenue,
    cost: r.cogs + r.expenses,
    net_profit: r.net_profit,
  }))
  const hasLoss = rows.some((r) => r.net_profit < 0)
  // Hiện số trên cột / điểm khi ít kỳ; nhiều kỳ thì chữ chồng nhau nên chỉ xem qua tooltip
  const showLabels = chartData.length <= 14
  const label = (v: unknown) => (Number(v) === 0 ? '' : formatCompact(Number(v), locale))

  return (
    <>
      <div className="stats">
        {fields.map(({ key, label }) => (
          <div className="stat" key={key}>
            <div className="stat-label">{t(label)}</div>
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
          <ComposedChart data={chartData} margin={{ top: showLabels ? 22 : 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              stroke="var(--border)"
              tickLine={false}
              minTickGap={8}
            />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v, locale)}
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
              name={t('Doanh thu thuần')}
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            >
              {showLabels && <LabelList dataKey="net_revenue" position="top" formatter={label} className="chart-label" fill="var(--chart-1)" />}
            </Bar>
            <Bar
              dataKey="cost"
              name={t('Giá vốn + chi phí')}
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            >
              {showLabels && <LabelList dataKey="cost" position="top" formatter={label} className="chart-label" fill="var(--chart-2)" />}
            </Bar>
            <Line
              dataKey="net_profit"
              name={t('Lãi ròng')}
              type="monotone"
              stroke="var(--chart-3)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--chart-3)', stroke: 'var(--surface)', strokeWidth: 2 }}
            >
              {showLabels && <LabelList dataKey="net_profit" position="top" offset={10} formatter={label} className="chart-label chart-label-line" fill="var(--chart-3)" />}
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('Kỳ')}</th>
              {fields.map(({ key, label }) => (
                <th key={key} className="num">
                  {t(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period_start}>
                <td>
                  {period === 'day' ? formatDate(row.period_start) : periodLabel(row.period_start, period, t)}
                </td>
                {fields.map(({ key }) => (
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
