import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PeriodFilters } from '../components/PeriodFilters'
import { initialPeriod, type PeriodState } from '../lib/period'
import { supabase } from '../lib/supabase'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { errorMessage, formatCompact, formatDate, formatVND, todayVN } from '../lib/format'
import { pctChange, previousRange, type Range } from '../lib/bundauReport'
import { fetchAll } from '../lib/fetchAll'
import { splitByLine } from '../lib/itemSales'
import type { MonthlyItemSale } from '../types/database'
import { REVENUE_CHANNELS, channelLabel, dayProfit, dayRevenue, filterDays, summarize, sumDays, type DayFilter, type DaySort, type RevenueChannel, type RevenueDay, type RevenueSummary } from '../lib/revenue'
import { DatePicker } from '../components/DatePicker'

type ItemLite = Pick<MonthlyItemSale, 'category' | 'net' | 'period_start' | 'period_end'>
type Loaded = { key: string; current: RevenueSummary; previous: RevenueSummary; expensesByCategory: { category: string; amount: number }[]; items: ItemLite[] }

// Màu mỗi kênh trên biểu đồ (chi phí dùng --chart-2, lãi dùng màu chữ)
const CHANNEL_COLOR: Record<RevenueChannel, string> = { in_store: 'var(--chart-1)', shopeefood: 'var(--chart-3)', nem_cuon: 'var(--chart-4)' }

// Báo cáo tổng quan quán Bún đậu (chỉ admin): doanh thu nhập tay, hoa hồng đối tác, chi phí và lãi theo kỳ so với kỳ trước.
export function RevenueReport({ storeId }: { storeId: string }) {
  const { t, lang } = useI18n()
  const { current: store } = useStore()
  const rate = store?.default_commission_rate ?? 0
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
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
    const prev = previousRange(range)
    const revenue = (r: Range) =>
      supabase.from('daily_revenue').select('revenue_date, channel, amount').eq('store_id', storeId).gte('revenue_date', r.from).lte('revenue_date', r.to).limit(5000)
    const expenses = (r: Range) =>
      supabase.from('expenses').select('expense_date, category, amount').eq('store_id', storeId).gte('expense_date', r.from).lte('expense_date', r.to).limit(5000)
    // Báo cáo mặt hàng có giao với khoảng đang xem (dùng để tách Bún bò khỏi Bún đậu)
    const items = fetchAll<ItemLite>((a, b) =>
      supabase.from('monthly_item_sales').select('category, net, period_start, period_end, item_code').eq('store_id', storeId).lte('period_start', range.to).gte('period_end', range.from).order('period_start').order('item_code').range(a, b),
    )
    Promise.all([revenue(range), expenses(range), revenue(prev), expenses(prev), items]).then(([rev, exp, prevRev, prevExp, itemRows]) => {
      if (cancelled) return
      const err = rev.error ?? exp.error ?? prevRev.error ?? prevExp.error
      if (err) return setError(errorMessage(err))
      setError(null)
      const byCat = new Map<string, number>()
      for (const e of exp.data ?? []) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount))
      setLoaded({
        key,
        current: summarize(rev.data ?? [], exp.data ?? [], rate),
        previous: summarize(prevRev.data ?? [], prevExp.data ?? [], rate),
        expensesByCategory: [...byCat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
        items: itemRows,
      })
    }).catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId, range, valid, key, rate])

  const filters = <PeriodFilters value={period} today={today} onChange={setPeriod} />

  if (!valid) {
    return (
      <div className="report-stack">
        {filters}
        <p className="error">{t('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".')}</p>
      </div>
    )
  }
  if (error) return <p className="error">{t(error)}</p>
  if (!loaded || loaded.key !== key) {
    return (
      <div className="report-stack">
        {filters}
        <p className="muted">{t('Đang tải…')}</p>
      </div>
    )
  }

  const { current: cur, previous: prev, expensesByCategory, items } = loaded
  const split = useMemo(() => splitByLine(items, range.from, range.to), [items, range.from, range.to])
  const pos = cur.byChannel.in_store + cur.byChannel.shopeefood
  const gap = pos - split.bunDau - split.bunBo
  const delta = (c: number, p: number) => {
    const change = pctChange(c, p)
    if (change === null) return undefined
    return `${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% ${t('so với kỳ trước')}`
  }
  const stat = (label: string, value: ReactNode, sub?: string, negative = false) => (
    <div className="stat">
      <div className="stat-label">{t(label)}</div>
      <div className={`stat-value${negative ? ' negative' : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
  const compact = (v: unknown) => (Number(v) === 0 ? '' : formatCompact(Number(v), locale))
  const chartData = useMemo(
    () =>
      cur.days.map((d) => ({
        label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`,
        in_store: d.byChannel.in_store,
        shopeefood: d.byChannel.shopeefood,
        nem_cuon: d.byChannel.nem_cuon,
        cost: d.expenses,
        profit: d.gross - d.commission - d.expenses,
      })),
    [cur.days],
  )
  const empty = cur.days.length === 0

  return (
    <div className="report-stack">
      {filters}

      <section className="report-block">
        <h2>{t('Kết quả kinh doanh')}</h2>
        <div className="stats">
          {stat('Doanh thu', formatVND(cur.gross), delta(cur.gross, prev.gross))}
          {stat('Thực thu (sau hoa hồng)', formatVND(cur.net), cur.commission > 0 ? t('Hoa hồng đối tác {fee}', { fee: formatVND(cur.commission) }) : undefined)}
          {stat('Chi phí', formatVND(cur.expenses), delta(cur.expenses, prev.expenses))}
          {stat('Lãi ròng', formatVND(cur.profit), cur.net > 0 ? t('Biên lãi {pct}%', { pct: Math.round((cur.profit / cur.net) * 100) }) : undefined, cur.profit < 0)}
        </div>
      </section>

      <section className="report-block">
        <h2>{t('Doanh thu theo kênh')}</h2>
        <div className="stats">
          {REVENUE_CHANNELS.map((c) => (
            <div key={c} className="stat">
              <div className="stat-label">
                <span className="channel-dot" style={{ background: CHANNEL_COLOR[c] }} aria-hidden="true" />
                {t(channelLabel(c))}
              </div>
              <div className="stat-value">{formatVND(cur.byChannel[c])}</div>
              <div className="stat-sub">
                {cur.gross > 0 ? t('{pct}% doanh thu', { pct: Math.round((cur.byChannel[c] / cur.gross) * 100) }) : '—'}
                {c === 'shopeefood' && cur.commission > 0 ? ` · ${t('Hoa hồng đối tác {fee}', { fee: formatVND(cur.commission) })}` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="report-block">
        <h2>{t('Doanh thu theo dòng món')}</h2>
        {split.used.length === 0 ? (
          <p className="muted">{t('Chưa có báo cáo mặt hàng nằm trọn trong khoảng này nên chưa tách được Bún bò. Nhập báo cáo mặt hàng ở mục Nhập liệu → Nhập mặt hàng (nên nhập theo từng ngày để tách chính xác).')}</p>
        ) : (
          <>
            <div className="stats">
              <div className="stat">
                <div className="stat-label">{t('Bún đậu')}</div>
                <div className="stat-value">{formatVND(split.bunDau)}</div>
                <div className="stat-sub">{t('Mọi mặt hàng trừ Bún bò')}</div>
              </div>
              <div className="stat">
                <div className="stat-label">{t('Bún bò')}</div>
                <div className="stat-value">{formatVND(split.bunBo)}</div>
                <div className="stat-sub">{split.bunBo + split.bunDau > 0 ? t('{pct}% doanh thu mặt hàng', { pct: Math.round((split.bunBo / (split.bunBo + split.bunDau)) * 100) }) : '—'}</div>
              </div>
              <div className="stat">
                <div className="stat-label">{t('Bán nem cuốn')}</div>
                <div className="stat-value">{formatVND(cur.byChannel.nem_cuon)}</div>
                <div className="stat-sub">{t('Không qua máy POS')}</div>
              </div>
              {Math.abs(gap) > 1 && (
                <div className="stat">
                  <div className="stat-label">{t('Chênh với doanh thu POS')}</div>
                  <div className={`stat-value${gap < 0 ? ' negative' : ''}`}>{`${gap > 0 ? '+' : '−'}${formatVND(Math.abs(gap))}`}</div>
                  <div className="stat-sub">{t('Doanh thu POS đã nhập {pos}, tổng mặt hàng {items}', { pos: formatVND(pos), items: formatVND(split.bunDau + split.bunBo) })}</div>
                </div>
              )}
            </div>
            <p className="muted">
              {t('Tính từ báo cáo mặt hàng: {ranges}.', { ranges: split.used.map((u) => (u.start === u.end ? formatDate(u.start) : `${formatDate(u.start)} – ${formatDate(u.end)}`)).join(', ') })}
              {split.skipped > 0 && ` ${t('{count} báo cáo chỉ giao một phần khoảng này nên chưa tính.', { count: split.skipped })}`}
            </p>
          </>
        )}
      </section>

      {empty ? (
        <p className="muted">{t('Chưa có doanh thu hay chi phí nào trong kỳ này.')}</p>
      ) : (
        <>
          <section className="report-block">
            <h2>{t('Doanh thu theo kênh, chi phí và lãi theo ngày')}</h2>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--border)" tickLine={false} minTickGap={8} />
                  <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--border)" tickLine={false} axisLine={false} width={52} />
                  <Tooltip
                    formatter={(v) => formatVND(Number(v))}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                    labelStyle={{ color: 'var(--text-h)', fontWeight: 600 }}
                    itemStyle={{ color: 'var(--text)' }}
                    cursor={{ fill: 'var(--border)', fillOpacity: 0.4 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  {REVENUE_CHANNELS.map((c, i) => (
                    <Bar key={c} dataKey={c} stackId="revenue" name={t(channelLabel(c))} fill={CHANNEL_COLOR[c]} radius={i === REVENUE_CHANNELS.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={26} />
                  ))}
                  <Bar dataKey="cost" name={t('Chi phí')} fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Line dataKey="profit" name={t('Lãi ròng')} type="monotone" stroke="var(--text-h)" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

            <section className="report-block">
              <h2>{t('Chi phí theo nhóm')}</h2>
              {expensesByCategory.length === 0 ? (
                <p className="muted">{t('Chưa có chi phí nào trong kỳ này.')}</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Nhóm')}</th>
                        <th className="num">{t('Số tiền')}</th>
                        <th className="num">{t('Tỷ trọng')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expensesByCategory.map((c) => (
                        <tr key={c.category}>
                          <td>{t(c.category)}</td>
                          <td className="num">{formatVND(c.amount)}</td>
                          <td className="num">{cur.expenses > 0 ? `${Math.round((c.amount / cur.expenses) * 100)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

          <DailyDetail days={cur.days} />
        </>
      )}
    </div>
  )
}

const EMPTY_FILTER: DayFilter = { from: '', to: '', channel: '', sort: 'date_desc' }
const SORTS: { value: DaySort; label: string }[] = [
  { value: 'date_desc', label: 'Ngày mới nhất' },
  { value: 'date_asc', label: 'Ngày cũ nhất' },
  { value: 'revenue_desc', label: 'Doanh thu cao nhất' },
  { value: 'profit_desc', label: 'Lãi cao nhất' },
]

// Bảng "Chi tiết theo ngày" có bộ lọc riêng (khoảng ngày trong kỳ đang xem, kênh, sắp xếp). Lọc theo kênh thì chỉ còn
// doanh thu kênh đó (chi phí và lãi không chia theo kênh nên ẩn).
function DailyDetail({ days }: { days: RevenueDay[] }) {
  const { t } = useI18n()
  const [f, setF] = useState<DayFilter>(EMPTY_FILTER)
  const rows = filterDays(days, f)
  const total = sumDays(rows)
  const byChannel = f.channel !== ''
  const changed = f.from !== '' || f.to !== '' || f.channel !== '' || f.sort !== 'date_desc'
  const sorts = byChannel ? SORTS.filter((s) => s.value !== 'profit_desc') : SORTS
  const money = (v: number) => (v > 0 ? formatVND(v) : '—')

  return (
    <section className="report-block">
      <h2>{t('Chi tiết theo ngày')}</h2>
      <div className="filters">
        <div className="field">
          {t('Từ ngày')}
          <DatePicker value={f.from} onChange={(v) => setF({ ...f, from: v })} label={t('Từ ngày')} />
        </div>
        <div className="field">
          {t('Đến ngày')}
          <DatePicker value={f.to} onChange={(v) => setF({ ...f, to: v })} label={t('Đến ngày')} />
        </div>
        <label>
          {t('Kênh')}
          <select value={f.channel} onChange={(e) => { const channel = e.target.value as RevenueChannel | ''; setF({ ...f, channel, sort: channel !== '' && f.sort === 'profit_desc' ? 'revenue_desc' : f.sort }) }}>
            <option value="">{t('Tất cả')}</option>
            {REVENUE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(channelLabel(c))}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Sắp xếp')}
          <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as DaySort })}>
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </label>
        {changed && (
          <button type="button" onClick={() => setF(EMPTY_FILTER)}>
            {t('Xoá lọc')}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted">{t('Không có ngày nào khớp bộ lọc.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Ngày')}</th>
                {byChannel ? (
                  <>
                    <th className="num">{t(channelLabel(f.channel as RevenueChannel))}</th>
                    <th className="num">{t('Tỷ trọng')}</th>
                    {f.channel === 'shopeefood' && <th className="num">{t('Hoa hồng')}</th>}
                  </>
                ) : (
                  <>
                    {REVENUE_CHANNELS.map((c) => (
                      <th key={c} className="num">
                        {t(channelLabel(c))}
                      </th>
                    ))}
                    <th className="num">{t('Doanh thu')}</th>
                    <th className="num">{t('Hoa hồng')}</th>
                    <th className="num">{t('Chi phí')}</th>
                    <th className="num">{t('Lãi ròng')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const profit = dayProfit(d)
                return (
                  <tr key={d.date}>
                    <td>{formatDate(d.date)}</td>
                    {byChannel ? (
                      <>
                        <td className="num">{formatVND(dayRevenue(d, f.channel))}</td>
                        <td className="num">{d.gross > 0 ? `${Math.round((dayRevenue(d, f.channel) / d.gross) * 100)}%` : '—'}</td>
                        {f.channel === 'shopeefood' && <td className="num">{money(d.commission)}</td>}
                      </>
                    ) : (
                      <>
                        {REVENUE_CHANNELS.map((c) => (
                          <td key={c} className="num">
                            {money(d.byChannel[c])}
                          </td>
                        ))}
                        <td className="num">{formatVND(d.gross)}</td>
                        <td className="num">{money(d.commission)}</td>
                        <td className="num">{money(d.expenses)}</td>
                        <td className={`num${profit < 0 ? ' negative' : ''}`}>{formatVND(profit)}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th>{t('Tổng {count} ngày', { count: rows.length })}</th>
                {byChannel ? (
                  <>
                    <th className="num">{formatVND(total.byChannel[f.channel as RevenueChannel])}</th>
                    <th className="num">{total.gross > 0 ? `${Math.round((total.byChannel[f.channel as RevenueChannel] / total.gross) * 100)}%` : '—'}</th>
                    {f.channel === 'shopeefood' && <th className="num">{money(total.commission)}</th>}
                  </>
                ) : (
                  <>
                    {REVENUE_CHANNELS.map((c) => (
                      <th key={c} className="num">
                        {money(total.byChannel[c])}
                      </th>
                    ))}
                    <th className="num">{formatVND(total.gross)}</th>
                    <th className="num">{money(total.commission)}</th>
                    <th className="num">{money(total.expenses)}</th>
                    <th className={`num${total.gross - total.commission - total.expenses < 0 ? ' negative' : ''}`}>{formatVND(total.gross - total.commission - total.expenses)}</th>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
