import { useStore } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { formatDate, formatVND } from '../lib/format'
import { batchStats, type BatchStat } from '../lib/analytics/batches'
import { useAnalyticsData } from '../lib/useAnalyticsData'

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`)

export function BatchStatsPage() {
  const { current } = useStore()
  return current ? <BatchStats key={current.id} storeId={current.id} /> : null
}

// Chỉ admin: thống kê theo đợt nhập (mỗi purchase là một đợt), chỉ món đếm tồn
function BatchStats({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const { loading, error, data } = useAnalyticsData(storeId)

  if (loading) return <p className="muted">{t('Đang tải…')}</p>
  if (error) return <p className="error">{t(error)}</p>
  if (!data) return null

  const { batches, totals } = batchStats(data.input, data.allocations, data.currentPrice, data.today)
  if (batches.length === 0) {
    return <p className="pos-empty muted">{t('Chưa có đợt nhập nào. Nhập hàng ở Kho hàng → Nhập hàng.')}</p>
  }

  const names = new Map(data.input.products.map((p) => [p.id, p.name]))
  // Cột "ngày hết" cho mỗi loại có xuất hiện trong ít nhất một đợt
  const productIds = data.input.products
    .filter((p) => batches.some((b) => b.lines.some((l) => l.productId === p.id)))
    .map((p) => p.id)

  const money = (v: number) => <span className={v < 0 ? 'negative' : undefined}>{formatVND(v)}</span>
  const status = (b: BatchStat) =>
    b.recovered ? (
      <span className="badge badge-ok">{t('Đã hoàn vốn')}</span>
    ) : (
      <span className="badge badge-low">{t('Chưa hoàn vốn')}</span>
    )
  const soldOut = (b: BatchStat) =>
    b.soldOutDate ? formatDate(b.soldOutDate) : t('Đang bán – ngày thứ {n}', { n: b.sellingDay ?? 0 })
  const notOut = (b: BatchStat) =>
    b.lines
      .filter((l) => l.remaining > 0)
      .map((l) => t('{name}: còn {count}', { name: names.get(l.productId) ?? '', count: l.remaining }))

  return (
    <section>
      <p className="muted section-note">
        {t('Mỗi đợt nhập là một dòng. Hũ bán được gán cho đợt cũ trước (FIFO); doanh thu là doanh thu thuần theo giá lúc bán.')}
      </p>
      <div className="table-wrap batch-wrap">
        <table className="batch-table">
          <thead>
            <tr>
              <th className="sticky-col">{t('Đợt nhập')}</th>
              <th className="num">{t('Tổng hũ')}</th>
              {productIds.map((id) => (
                <th key={id} className="num">
                  {t('Nhập: {name}', { name: names.get(id) ?? '' })}
                </th>
              ))}
              <th className="num">{t('Vốn nhập')}</th>
              <th className="num">{t('Đã bán')}</th>
              <th className="num">{t('% đã bán')}</th>
              <th className="num">{t('Doanh thu')}</th>
              <th className="num">{t('Giá vốn hàng bán')}</th>
              <th className="num">{t('Lãi gộp')}</th>
              <th className="num">{t('Còn tồn')}</th>
              <th className="num">{t('Giá trị tồn')}</th>
              <th className="num">{t('% vốn thu hồi')}</th>
              <th>{t('Trạng thái')}</th>
              <th>{t('Ngày hoà vốn')}</th>
              <th className="num">{t('Lãi/lỗ nếu bán hết')}</th>
              <th>{t('Ngày hết cả đợt')}</th>
              <th className="num">{t('Số ngày bán hết')}</th>
              <th>{t('Loại hết trước')}</th>
              <th>{t('Loại hết sau cùng')}</th>
              <th>{t('Loại còn chưa hết')}</th>
              {productIds.map((id) => (
                <th key={id}>{t('Hết: {name}', { name: names.get(id) ?? '' })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => (
              <tr key={b.purchaseId}>
                <td className="sticky-col">
                  <strong>{t('Đợt {n}', { n: i + 1 })}</strong>
                  <small className="batch-date">{formatDate(b.date)}</small>
                  {b.note && <small className="muted batch-date">{b.note}</small>}
                </td>
                <td className="num">{b.totalQty}</td>
                {productIds.map((id) => (
                  <td key={id} className="num">
                    {b.lines.find((l) => l.productId === id)?.qty ?? '—'}
                  </td>
                ))}
                <td className="num">{formatVND(b.cost)}</td>
                <td className="num">{b.sold}</td>
                <td className="num">{pct(b.soldPct)}</td>
                <td className="num">{formatVND(b.revenue)}</td>
                <td className="num">{formatVND(b.cogs)}</td>
                <td className="num">{money(b.grossProfit)}</td>
                <td className="num">{b.remaining}</td>
                <td className="num">{formatVND(b.remainingValue)}</td>
                <td className="num">{pct(b.recoveryPct)}</td>
                <td>{status(b)}</td>
                <td>{b.breakEvenDate ? formatDate(b.breakEvenDate) : '—'}</td>
                <td className="num">{money(b.projectedProfit)}</td>
                <td>{soldOut(b)}</td>
                <td className="num">{b.daysToSellOut ?? '—'}</td>
                <td>{b.firstOutProductId ? names.get(b.firstOutProductId) : '—'}</td>
                <td>{b.lastOutProductId ? names.get(b.lastOutProductId) : '—'}</td>
                <td className="wrap-cell">
                  {notOut(b).length > 0 ? notOut(b).map((text) => <div key={text}>{text}</div>) : '—'}
                </td>
                {productIds.map((id) => {
                  const line = b.lines.find((l) => l.productId === id)
                  return (
                    <td key={id}>
                      {!line ? '' : line.soldOutDate ? formatDate(line.soldOutDate) : t('Còn {count} hũ', { count: line.remaining })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="sticky-col">{t('Tổng cộng')}</td>
              <td className="num">{totals.totalQty}</td>
              {productIds.map((id) => (
                <td key={id} className="num">
                  {batches.reduce((sum, b) => sum + (b.lines.find((l) => l.productId === id)?.qty ?? 0), 0)}
                </td>
              ))}
              <td className="num">{formatVND(totals.cost)}</td>
              <td className="num">{totals.sold}</td>
              <td className="num">{pct(totals.totalQty > 0 ? totals.sold / totals.totalQty : null)}</td>
              <td className="num">{formatVND(totals.revenue)}</td>
              <td className="num">{formatVND(totals.cogs)}</td>
              <td className="num">{money(totals.grossProfit)}</td>
              <td className="num">{totals.remaining}</td>
              <td className="num">{formatVND(totals.remainingValue)}</td>
              <td className="num">{pct(totals.cost > 0 ? totals.revenue / totals.cost : null)}</td>
              <td colSpan={8 + productIds.length} />
            </tr>
            <tr>
              <td className="sticky-col">{t('Trừ chi phí')}</td>
              <td colSpan={6 + productIds.length} />
              <td className="num">{money(-totals.expenses)}</td>
              <td colSpan={11 + productIds.length} />
            </tr>
            <tr className="net-row">
              <td className="sticky-col">{t('Lợi nhuận ròng tất cả các đợt')}</td>
              <td colSpan={6 + productIds.length} />
              <td className="num">{money(totals.netProfit)}</td>
              <td colSpan={11 + productIds.length} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
