import { useEffect, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DatePicker } from '../components/DatePicker'
import { IngredientStockTable } from '../components/IngredientStockTable'
import { StockAlertBanner } from '../components/StockAlertBanner'
import { supabase } from '../lib/supabase'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { errorMessage, formatCompact, formatDate, formatVND, todayVN } from '../lib/format'
import { buildInsights, hourBuckets, pctChange, presetRange, previousRange, type Preset, type Range } from '../lib/bundauReport'
import { ingredientStatus } from '../lib/ingredients'
import type { BundauReport as ReportData, IngredientStockRow, PnlRow, StockStatusRow } from '../types/database'

type Loaded = {
  key: string
  report: ReportData
  previous: ReportData
  pnl: PnlRow[]
  ingredients: IngredientStockRow[]
  drinks: StockStatusRow[]
  expensesByCategory: { category: string; amount: number }[]
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: 'month', label: 'Tháng này' },
  { value: 'lastMonth', label: 'Tháng trước' },
]
const RECENT_DAYS = 7
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

// Báo cáo tổng quan riêng cho quán Bún đậu (chỉ admin): doanh thu và lãi theo kỳ so với kỳ trước, kênh bán,
// món bán chạy, giờ đông khách, tồn nguyên liệu (tính theo doanh thu × công thức), đồ uống, chi phí và gợi ý.
export function BundauReport({ storeId }: { storeId: string }) {
  const { t, lang } = useI18n()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const today = todayVN()
  const [preset, setPreset] = useState<Preset | 'custom'>('7d')
  const [range, setRange] = useState<Range>(() => presetRange('7d', today))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valid = range.from !== '' && range.to !== '' && range.from <= range.to
  const key = `${storeId}|${range.from}|${range.to}`

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    const prev = previousRange(range)
    Promise.all([
      supabase.rpc('get_bundau_report', { p_store_id: storeId, p_from: range.from, p_to: range.to }),
      supabase.rpc('get_bundau_report', { p_store_id: storeId, p_from: prev.from, p_to: prev.to }),
      supabase.rpc('get_pnl', { p_store_id: storeId, p_period: 'day', p_from: range.from, p_to: range.to }),
      supabase.rpc('get_ingredient_stock', { p_store_id: storeId, p_recent_days: RECENT_DAYS }),
      supabase.rpc('get_stock_status', { p_store_id: storeId }),
      supabase.from('expenses').select('category, amount').eq('store_id', storeId).gte('expense_date', range.from).lte('expense_date', range.to).limit(5000),
    ]).then(([report, previous, pnl, ingredients, drinks, expenses]) => {
      if (cancelled) return
      const err = report.error ?? previous.error ?? pnl.error ?? ingredients.error ?? drinks.error ?? expenses.error
      if (err) return setError(errorMessage(err))
      setError(null)
      const byCat = new Map<string, number>()
      for (const e of expenses.data ?? []) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount))
      setLoaded({
        key,
        report: report.data!,
        previous: previous.data!,
        pnl: pnl.data ?? [],
        ingredients: ingredients.data ?? [],
        drinks: drinks.data ?? [],
        expensesByCategory: [...byCat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, range, valid, key])

  const pick = (p: Preset) => {
    setPreset(p)
    setRange(presetRange(p, today))
  }

  const filters = (
    <div className="filters">
      <div className="preset-chips" role="group" aria-label={t('Khoảng thời gian')}>
        {PRESETS.map((p) => (
          <button key={p.value} type="button" className={preset === p.value ? 'active' : undefined} onClick={() => pick(p.value)}>
            {t(p.label)}
          </button>
        ))}
      </div>
      <div className="field">
        {t('Từ ngày')}
        <DatePicker value={range.from} onChange={(v) => { setPreset('custom'); setRange((r) => ({ ...r, from: v })) }} label={t('Từ ngày')} />
      </div>
      <div className="field">
        {t('Đến ngày')}
        <DatePicker value={range.to} onChange={(v) => { setPreset('custom'); setRange((r) => ({ ...r, to: v })) }} label={t('Đến ngày')} />
      </div>
    </div>
  )

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

  const { report, previous, pnl, ingredients, drinks, expensesByCategory } = loaded
  const tot = report.totals
  const prevTot = previous.totals
  const pnlSum = (k: keyof PnlRow) => sum(pnl.map((r) => Number(r[k])))
  const expenses = pnlSum('expenses')
  const netProfit = pnlSum('net_profit')
  const netRevenue = pnlSum('net_revenue')
  const avgTicket = tot.orders > 0 ? tot.gross / tot.orders : 0
  const prevAvg = prevTot.orders > 0 ? prevTot.gross / prevTot.orders : 0
  const ingredientExpenses = expensesByCategory.find((c) => c.category === 'Nguyên liệu')?.amount ?? 0
  const totalExpenseAll = sum(expensesByCategory.map((c) => c.amount))

  const delta = (cur: number, prev: number) => {
    const c = pctChange(cur, prev)
    if (c === null) return undefined
    return `${c >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(c * 100))}% ${t('so với kỳ trước')}`
  }
  const stat = (label: string, value: ReactNode, sub?: string, negative = false) => (
    <div className="stat">
      <div className="stat-label">{t(label)}</div>
      <div className={`stat-value${negative ? ' negative' : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )

  const drinkRows = drinks.map((d) => ({ name: d.product_name, onHand: d.qty_shop, threshold: d.low_stock_threshold }))
  const insights = buildInsights({
    report,
    previous,
    expenses,
    ingredientExpenses,
    ingredients,
    recentDays: RECENT_DAYS,
    drinks: drinkRows,
    fmt: formatVND,
  })

  const alertRows = [
    ...ingredients.map((g) => ({ name: g.name, shopStatus: ingredientStatus(g.on_hand, g.low_stock_threshold) })),
    ...drinks.map((d) => ({ name: d.product_name, shopStatus: d.qty_shop <= 0 ? ('out' as const) : d.qty_shop <= d.low_stock_threshold ? ('low' as const) : ('ok' as const) })),
  ]
  const out = alertRows.filter((r) => r.shopStatus === 'out' || r.shopStatus === 'check').map((r) => r.name)
  const low = alertRows.filter((r) => r.shopStatus === 'low').map((r) => r.name)

  const chartData = pnl.map((r) => ({
    label: `${r.period_start.slice(8, 10)}/${r.period_start.slice(5, 7)}`,
    revenue: r.net_revenue,
    cost: r.cogs + r.expenses,
    profit: r.net_profit,
  }))
  const hours = hourBuckets(report.hours)
  const peak = Math.max(0, ...hours.map((h) => h.orders))
  const compact = (v: unknown) => (Number(v) === 0 ? '' : formatCompact(Number(v), locale))
  const channelName = (c: string) => (c === 'shopeefood' ? t('Đối tác') : c === 'company' ? t('Công ty') : t('Quán'))

  return (
    <div className="report-stack bundau-report">
      {(out.length > 0 || low.length > 0) && (
        <StockAlertBanner restock alerts={{ level: out.length ? 'red' : 'orange', out, low, check: [] }} />
      )}

      {filters}

      <section className="report-block">
        <h2>{t('Kết quả kinh doanh')}</h2>
        <div className="stats">
          {stat('Doanh thu', formatVND(tot.gross), delta(tot.gross, prevTot.gross))}
          {stat('Số đơn', formatAmount0(tot.orders), delta(tot.orders, prevTot.orders))}
          {stat('Giá trị TB / đơn', formatVND(avgTicket), delta(avgTicket, prevAvg))}
          {stat('Số phần đã bán', formatAmount0(tot.portions), delta(tot.portions, prevTot.portions))}
          {stat('Thực thu (sau hoa hồng)', formatVND(netRevenue), tot.commission > 0 ? t('Hoa hồng đối tác {fee}', { fee: formatVND(tot.commission) }) : undefined)}
          {stat('Chi phí', formatVND(expenses), t('Chưa gồm tiền nhập đồ uống (đã vào giá vốn)'))}
          {stat('Lãi ròng', formatVND(netProfit), tot.gross > 0 ? t('Biên lãi {pct}%', { pct: Math.round((netProfit / Math.max(netRevenue, 1)) * 100) }) : undefined, netProfit < 0)}
          {tot.discount > 0 && stat('Giảm giá đã cho', formatVND(tot.discount))}
        </div>
      </section>

      <section className="report-block">
        <h2>{t('Gợi ý cho chủ quán')}</h2>
        <ul className="insights">
          {insights.map((i, k) => (
            <li key={k} className={`insight insight-${i.tone}`}>
              {t(i.key, i.params)}
            </li>
          ))}
        </ul>
      </section>

      {chartData.length > 0 && (
        <section className="report-block">
          <h2>{t('Doanh thu, chi phí và lãi theo ngày')}</h2>
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
                <Bar dataKey="revenue" name={t('Thực thu')} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="cost" name={t('Giá vốn + chi phí')} fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Line dataKey="profit" name={t('Lãi ròng')} type="monotone" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="report-block">
          <h2>{t('Kênh bán')}</h2>
          {report.channels.length === 0 ? (
            <p className="muted">{t('Chưa có đơn nào trong kỳ này.')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Kênh')}</th>
                    <th className="num">{t('Số đơn')}</th>
                    <th className="num">{t('Doanh thu')}</th>
                    <th className="num">{t('Tỷ trọng')}</th>
                    <th className="num">{t('Hoa hồng')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.channels.map((c) => (
                    <tr key={c.channel}>
                      <td>{channelName(c.channel)}</td>
                      <td className="num">{c.orders}</td>
                      <td className="num">{formatVND(c.gross)}</td>
                      <td className="num">{tot.gross > 0 ? `${Math.round((c.gross / tot.gross) * 100)}%` : '—'}</td>
                      <td className="num">{c.commission > 0 ? formatVND(c.commission) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="report-block">
          <h2>{t('Giờ đông khách')}</h2>
          {peak === 0 ? (
            <p className="muted">{t('Chưa có đơn nào trong kỳ này.')}</p>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hours.map((h) => ({ ...h, label: `${h.hour}h` }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--border)" tickLine={false} interval={1} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--border)" tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    formatter={(v) => [`${v} ${t('đơn')}`, t('Số đơn')]}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                    cursor={{ fill: 'var(--border)', fillOpacity: 0.4 }}
                  />
                  <Bar dataKey="orders" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="report-block">
        <h2>{t('Món bán chạy')}</h2>
        {report.top.length === 0 ? (
          <p className="muted">{t('Chưa có đơn nào trong kỳ này.')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Món')}</th>
                  <th className="num">{t('Số phần')}</th>
                  <th className="num">{t('Doanh thu')}</th>
                  <th className="num">{t('Tỷ trọng')}</th>
                </tr>
              </thead>
              <tbody>
                {report.top.map((m, i) => (
                  <tr key={m.name}>
                    <td>{i + 1}</td>
                    <td>{m.name}</td>
                    <td className="num">{m.qty}</td>
                    <td className="num">{formatVND(m.revenue)}</td>
                    <td className="num">{tot.gross > 0 ? `${Math.round((m.revenue / tot.gross) * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="report-block">
        <h2>{t('Tồn kho nguyên liệu')}</h2>
        {ingredients.length === 0 ? (
          <p className="muted">{t('Chưa có nguyên liệu nào. Thêm ở Quản lý → Nguyên liệu, nhập ở Kho hàng → Nhập hàng.')}</p>
        ) : (
          <IngredientStockTable rows={ingredients} recentDays={RECENT_DAYS} />
        )}
      </section>

      <section className="report-block">
        <h2>{t('Tồn đồ uống')}</h2>
        {drinks.length === 0 ? (
          <p className="muted">{t('Chưa có đồ uống nào đếm tồn kho.')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Loại')}</th>
                  <th className="num">{t('Còn tại quán')}</th>
                  <th className="num">{t('Ngưỡng')}</th>
                  <th>{t('Trạng thái')}</th>
                </tr>
              </thead>
              <tbody>
                {drinks.map((d) => {
                  const status = d.qty_shop <= 0 ? 'out' : d.qty_shop <= d.low_stock_threshold ? 'low' : 'ok'
                  return (
                    <tr key={d.product_id}>
                      <td>{d.product_name}</td>
                      <td className="num">
                        <strong>{d.qty_shop}</strong>
                      </td>
                      <td className="num">{d.low_stock_threshold}</td>
                      <td>
                        <span className={`badge ${status === 'ok' ? 'badge-ok' : status === 'low' ? 'badge-warn' : 'badge-bad'}`}>
                          {status === 'ok' ? t('Ổn') : status === 'low' ? t('Sắp hết') : t('Hết')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="report-block">
        <h2>{t('Chi phí theo nhóm')}</h2>
        {expensesByCategory.length === 0 ? (
          <p className="muted">{t('Chưa có chi phí trong khoảng này.')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Nhóm')}</th>
                  <th className="num">{t('Thành tiền')}</th>
                  <th className="num">{t('Tỷ trọng')}</th>
                </tr>
              </thead>
              <tbody>
                {expensesByCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{t(c.category)}</td>
                    <td className="num">{formatVND(c.amount)}</td>
                    <td className="num">{totalExpenseAll > 0 ? `${Math.round((c.amount / totalExpenseAll) * 100)}%` : '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>{t('Tổng chi phí')}</strong>
                  </td>
                  <td className="num">
                    <strong>{formatVND(totalExpenseAll)}</strong>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <small className="muted">
          {t('Gồm cả tiền nhập đồ uống tự ghi vào Chi phí; phần đó không trừ thêm vào lãi ròng vì đã tính trong giá vốn khi bán.')} {formatDate(range.from)} – {formatDate(range.to)}
        </small>
      </section>
    </div>
  )
}

const formatAmount0 = (n: number) => new Intl.NumberFormat('vi-VN').format(n)
