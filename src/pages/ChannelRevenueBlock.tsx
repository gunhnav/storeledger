import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PeriodFilters } from '../components/PeriodFilters'
import { supabase } from '../lib/supabase'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { errorMessage, formatCompact, formatDate, formatVND, todayVN } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import { pctChange, previousRange } from '../lib/bundauReport'
import { initialPeriod, type PeriodState } from '../lib/period'
import { SALE_CHANNELS, saleChannelLabel, summarizeByChannel, type ChannelSummary, type SaleLite } from '../lib/channelRevenue'
import type { SaleChannel } from '../types/database'

const COLOR: Record<SaleChannel, string> = { in_store: 'var(--chart-1)', company: 'var(--chart-4)', shopeefood: 'var(--chart-3)' }

function ChannelRevenueView({ cur, prev, locale }: { cur: ChannelSummary; prev: ChannelSummary; locale: string }) {
  const { t } = useI18n()
  const channels = useMemo(
    () => SALE_CHANNELS.filter((c) => c !== 'shopeefood' || cur.byChannel.shopeefood.orders > 0 || prev.byChannel.shopeefood.orders > 0),
    [cur.byChannel.shopeefood.orders, prev.byChannel.shopeefood.orders],
  )
  const change = pctChange(cur.total, prev.total)
  const compact = (v: unknown) => (Number(v) === 0 ? '' : formatCompact(Number(v), locale))
  const chartData = useMemo(() => cur.days.map((d) => ({ label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`, ...d.byChannel })), [cur.days])

  return (
    <>
      <div className="stats">
        {channels.map((c) => (
          <div key={c} className="stat">
            <div className="stat-label">
              <span className="channel-dot" style={{ background: COLOR[c] }} aria-hidden="true" />
              {t(saleChannelLabel(c))}
            </div>
            <div className="stat-value">{formatVND(cur.byChannel[c].amount)}</div>
            <div className="stat-sub">
              {cur.total > 0 ? t('{pct}% doanh thu', { pct: Math.round((cur.byChannel[c].amount / cur.total) * 100) }) : '—'} · {t('{count} đơn', { count: cur.byChannel[c].orders })}
            </div>
          </div>
        ))}
        <div className="stat">
          <div className="stat-label">{t('Tổng doanh thu')}</div>
          <div className="stat-value">{formatVND(cur.total)}</div>
          <div className="stat-sub">
            {t('{count} đơn', { count: cur.orders })}
            {change !== null && ` · ${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% ${t('so với kỳ trước')}`}
          </div>
        </div>
      </div>

      {cur.days.length === 0 ? (
        <p className="muted">{t('Chưa có đơn bán nào trong kỳ này.')}</p>
      ) : (
        <>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={240}>
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
                {channels.map((c, i) => (
                  <Bar key={c} dataKey={c} stackId="revenue" name={t(saleChannelLabel(c))} fill={COLOR[c]} radius={i === channels.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={26} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Ngày')}</th>
                  {channels.map((c) => (
                    <th key={c} className="num">
                      {t(saleChannelLabel(c))}
                    </th>
                  ))}
                  <th className="num">{t('Tổng doanh thu')}</th>
                </tr>
              </thead>
              <tbody>
                {[...cur.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date)}</td>
                    {channels.map((c) => (
                      <td key={c} className="num">
                        {d.byChannel[c] > 0 ? formatVND(d.byChannel[c]) : '—'}
                      </td>
                    ))}
                    <td className="num">{formatVND(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

// Doanh thu bán hàng của Hogi chia theo kênh (Quán / Công ty), theo khoảng ngày chọn, so với kỳ trước (chỉ admin).
export function ChannelRevenueBlock({ storeId }: { storeId: string }) {
  const { t, lang } = useI18n()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const today = todayVN()
  const [period, setPeriod] = useState<PeriodState>(() => initialPeriod('month', today))
  const [data, setData] = useState<{ key: string; current: ChannelSummary; previous: ChannelSummary } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { range } = period
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to
  const key = `${storeId}|${range.from}|${range.to}`

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    const prev = previousRange(range)
    const sales = (r: { from: string; to: string }) =>
      fetchAll<SaleLite>((a, b) =>
        supabase.from('sales').select('sale_date, channel, total_amount').eq('store_id', storeId).gte('sale_date', r.from).lte('sale_date', r.to).order('sale_date').order('id').range(a, b),
      )
    Promise.all([sales(range), sales(prev)])
      .then(([cur, previous]) => {
        if (cancelled) return
        setError(null)
        setData({ key, current: summarizeByChannel(cur), previous: summarizeByChannel(previous) })
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId, range, valid, key])

  const filters = <PeriodFilters value={period} today={today} onChange={setPeriod} />
  let body
  if (!valid) body = <p className="error">{t('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".')}</p>
  else if (error) body = <p className="error">{t(error)}</p>
  else if (!data || data.key !== key) body = <p className="muted">{t('Đang tải…')}</p>
  else body = <ChannelRevenueView cur={data.current} prev={data.previous} locale={locale} />

  return (
    <section className="report-block">
      <h2>{t('Doanh thu theo kênh')}</h2>
      {filters}
      {body}
    </section>
  )
}
