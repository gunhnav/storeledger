import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PeriodFilters } from '../components/PeriodFilters'
import { initialPeriod, type PeriodState } from '../lib/period'
import { supabase } from '../lib/supabase'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { errorMessage, formatCompact, formatDate, formatVND, todayVN } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import { pctChange, previousRange } from '../lib/bundauReport'
import { FIXED_GROUPS } from '../lib/expenses'
import { expenseByGroup, expenseRatio, fixedTotal, totalOf } from '../lib/expenseReport'

type Row = { id: string; expense_date: string; category: string; amount: number; note: string | null }
type Loaded = { key: string; current: Row[]; previous: Row[]; revenue: number }

// Báo cáo chi phí theo nhóm (chỉ admin, quán Bún đậu): tổng từng nhóm, tỷ trọng, so với kỳ trước, chi phí cố định
// (tiền nhà, điện nước, lương), chi phí trên doanh thu và danh sách khoản chi trong từng nhóm.
export function ExpenseReport() {
  const { current } = useStore()
  return current ? <Report key={current.id} storeId={current.id} /> : null
}

function Report({ storeId }: { storeId: string }) {
  const { t, lang } = useI18n()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const today = todayVN()
  const [period, setPeriod] = useState<PeriodState>(() => initialPeriod('month', today))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Các nhóm đang mở chi tiết (bấm vào dòng nhóm trong bảng hoặc cột trên biểu đồ)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const { range } = period
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to
  const key = `${storeId}|${range.from}|${range.to}`

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    const prev = previousRange(range)
    const expenses = (r: { from: string; to: string }) =>
      fetchAll<Row>((a, b) =>
        supabase.from('expenses').select('id, expense_date, category, amount, note').eq('store_id', storeId).gte('expense_date', r.from).lte('expense_date', r.to).order('expense_date', { ascending: false }).order('id').range(a, b),
      )
    const revenue = fetchAll<{ amount: number }>((a, b) =>
      supabase.from('daily_revenue').select('amount').eq('store_id', storeId).gte('revenue_date', range.from).lte('revenue_date', range.to).order('revenue_date').order('channel').range(a, b),
    )
    Promise.all([expenses(range), expenses(prev), revenue])
      .then(([cur, previous, rev]) => {
        if (cancelled) return
        setError(null)
        setLoaded({ key, current: cur, previous, revenue: rev.reduce((s, r) => s + Number(r.amount), 0) })
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId, range, valid, key])

  const toggle = (category: string) =>
    setOpen((o) => {
      const next = new Set(o)
      if (!next.delete(category)) next.add(category)
      return next
    })

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

  const { current, previous, revenue } = loaded
  const groups = expenseByGroup(current, previous)
  const total = totalOf(current)
  const prevTotal = totalOf(previous)
  const fixed = fixedTotal(current)
  const ratio = expenseRatio(total, revenue)
  const compact = (v: unknown) => (Number(v) === 0 ? '' : formatCompact(Number(v), locale))
  const delta = (cur: number, prev: number) => {
    const c = pctChange(cur, prev)
    if (c === null) return undefined
    return `${c >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(c * 100))}% ${t('so với kỳ trước')}`
  }
  const stat = (label: string, value: ReactNode, sub?: string) => (
    <div className="stat">
      <div className="stat-label">{t(label)}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
  const chartData = groups.filter((g) => g.amount > 0).map((g) => ({ name: t(g.category), category: g.category, amount: g.amount }))
  const top = groups[0]

  return (
    <div className="report-stack">
      {filters}

      <section className="report-block">
        <h2>{t('Tổng chi phí')}</h2>
        <div className="stats">
          {stat('Tổng chi phí', formatVND(total), delta(total, prevTotal))}
          {stat('Chi phí / doanh thu', ratio === null ? '—' : `${Math.round(ratio * 100)}%`, revenue > 0 ? t('Doanh thu {amount}', { amount: formatVND(revenue) }) : t('Chưa có doanh thu trong kỳ này.'))}
          {stat('Chi phí cố định', formatVND(fixed), FIXED_GROUPS.map((g) => t(g)).join(', '))}
          {top && top.amount > 0 && stat('Nhóm chi nhiều nhất', t(top.category), `${formatVND(top.amount)} (${Math.round(top.share * 100)}%)`)}
        </div>
      </section>

      {current.length === 0 ? (
        <p className="muted">{t('Chưa có chi phí nào trong kỳ này.')}</p>
      ) : (
        <>
          <section className="report-block">
            <h2>{t('Chi phí theo nhóm')}</h2>
            <p className="muted">{t('Bấm vào một nhóm để xem từng khoản chi trong nhóm đó.')}</p>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 38 + 30)}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--border)" tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--border)" tickLine={false} />
                  <Tooltip
                    formatter={(v) => formatVND(Number(v))}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                    cursor={{ fill: 'var(--border)', fillOpacity: 0.4 }}
                  />
                  <Bar dataKey="amount" name={t('Số tiền')} fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={26} cursor="pointer" onClick={(d) => toggle((d as unknown as { category: string }).category)} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Nhóm')}</th>
                    <th className="num">{t('Số khoản')}</th>
                    <th className="num">{t('Số tiền')}</th>
                    <th className="num">{t('Tỷ trọng')}</th>
                    <th className="num">{t('Kỳ trước')}</th>
                    <th className="num">{t('Thay đổi')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const change = pctChange(g.amount, g.previous)
                    const isOpen = open.has(g.category)
                    const items = current.filter((r) => r.category === g.category)
                    return (
                      <Fragment key={g.category}>
                        <tr className={`group-row${isOpen ? ' is-open' : ''}`}>
                          <td>
                            <button type="button" className="link group-toggle" aria-expanded={isOpen} disabled={g.count === 0} onClick={() => toggle(g.category)}>
                              <span aria-hidden="true">{g.count === 0 ? '·' : isOpen ? '▾' : '▸'}</span> {t(g.category)}
                            </button>
                            {FIXED_GROUPS.includes(g.category) && <small className="muted"> · {t('cố định')}</small>}
                          </td>
                          <td className="num">{g.count}</td>
                          <td className="num">{formatVND(g.amount)}</td>
                          <td className="num">{total > 0 ? `${Math.round(g.share * 100)}%` : '—'}</td>
                          <td className="num">{g.previous > 0 ? formatVND(g.previous) : '—'}</td>
                          <td className={`num${change !== null && change > 0 ? ' negative' : ''}`}>{change === null ? '—' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}%`}</td>
                        </tr>
                        {isOpen && (
                          <tr className="group-detail">
                            <td colSpan={6}>
                              <table>
                                <thead>
                                  <tr>
                                    <th>{t('Ngày')}</th>
                                    <th>{t('Khoản chi')}</th>
                                    <th className="num">{t('Số tiền')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((r) => (
                                    <tr key={r.id}>
                                      <td>{formatDate(r.expense_date)}</td>
                                      <td>{r.note ?? ''}</td>
                                      <td className="num">{formatVND(Number(r.amount))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

        </>
      )}
    </div>
  )
}
