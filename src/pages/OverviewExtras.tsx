import type { ReactNode } from 'react'
import { StockAlertBanner, StockStatusBadge } from '../components/StockAlertBanner'
import { useI18n } from '../lib/i18n'
import { formatDate, formatVND } from '../lib/format'
import { financialSummary, productResults, stockAlerts, stockRows } from '../lib/analytics/overview'
import { useAnalyticsData } from '../lib/useAnalyticsData'

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`)

// Phần bổ sung của tab Tổng quan (chỉ admin): banner, tồn kho, kết quả theo loại, dòng tiền, dự báo hoà vốn
export function OverviewExtras({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const { loading, error, data } = useAnalyticsData(storeId)

  if (loading) return <p className="muted">{t('Đang tải…')}</p>
  if (error) return <p className="error">{t(error)}</p>
  if (!data) return null

  const rows = stockRows(data.input)
  const results = productResults(data.input, data.allocations, data.currentPrice)
  const s = financialSummary(data.input, data.allocations, data.currentPrice)
  const money = (v: number) => <span className={v < 0 ? 'negative' : undefined}>{formatVND(v)}</span>
  const stat = (label: string, value: ReactNode, sub?: string) => (
    <div className="stat">
      <div className="stat-label">{t(label)}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )

  return (
    <div className="report-stack overview-extras">
      {rows.length > 0 && <StockAlertBanner alerts={stockAlerts(rows)} />}

      {rows.length > 0 && (
        <div className="two-col">
          <div>
            <h2>{t('Tồn kho tại nhà')}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Loại')}</th>
                    <th className="num">{t('Nhập hàng')}</th>
                    <th className="num">{t('Quán')}</th>
                    <th className="num">{t('Công ty')}</th>
                    <th className="num">{t('Nhà')}</th>
                    <th>{t('Trạng thái')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      {/* Nhập hàng = phân phối ra quán + cho công ty + còn ở nhà */}
                      <td className="num">{r.purchased}</td>
                      <td className="num">{r.movedShop}</td>
                      <td className="num">{r.moved - r.movedShop}</td>
                      <td className="num">{r.home}</td>
                      <td>
                        <StockStatusBadge status={r.homeStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2>{t('Tồn tại quán')}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Loại')}</th>
                    <th className="num">{t('Đã mang ra')}</th>
                    <th className="num">{t('Đã bán')}</th>
                    <th className="num">{t('Còn tại quán')}</th>
                    <th className="num">{t('Ngưỡng')}</th>
                    <th>{t('Trạng thái')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td className="num">{r.movedShop}</td>
                      <td className="num">{r.sold}</td>
                      <td className="num">{r.shop}</td>
                      <td className="num">{r.threshold}</td>
                      <td>
                        <StockStatusBadge status={r.shopStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2>{t('Kết quả theo loại')}</h2>
        {results.length === 0 ? (
          <p className="muted">{t('Chưa có giao dịch trong khoảng này.')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Loại')}</th>
                  <th className="num">{t('Giá bán hiện hành')}</th>
                  <th className="num">{t('Giá vốn BQ/hũ bán')}</th>
                  <th className="num">{t('Hũ bán')}</th>
                  <th className="num">{t('Doanh thu')}</th>
                  <th className="num">{t('Giá vốn')}</th>
                  <th className="num">{t('Lãi gộp')}</th>
                  <th className="num">{t('Lãi/hũ')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td className="num">{formatVND(r.currentPrice)}</td>
                    <td className="num">{r.avgCost === null ? '—' : formatVND(r.avgCost)}</td>
                    <td className="num">{r.sold}</td>
                    <td className="num">{formatVND(r.revenue)}</td>
                    <td className="num">{formatVND(r.cogs)}</td>
                    <td className="num">{money(r.grossProfit)}</td>
                    <td className="num">{r.profitPerUnit === null ? '—' : money(r.profitPerUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2>{t('Lãi lỗ & dòng tiền')}</h2>
        <div className="stats">
          {stat('Doanh thu thuần', money(s.revenue))}
          {stat('Giá vốn hàng bán', money(s.cogs))}
          {stat('Lãi gộp', money(s.grossProfit))}
          {stat('Chi phí', money(s.expenses))}
          {stat('Lợi nhuận ròng', money(s.netProfit))}
          {stat('Biên lợi nhuận', <span className={s.margin !== null && s.margin < 0 ? 'negative' : undefined}>{pct(s.margin)}</span>)}
          {stat('Tổng đã chi', money(s.totalSpent), t('Nhập hàng {purchase} + chi phí {expenses}', { purchase: formatVND(s.totalPurchase), expenses: formatVND(s.expenses) }))}
          {stat('Dòng tiền ròng', money(s.cashFlow))}
          {stat('Còn phải bán thêm để hoàn vốn', money(s.remainingToRecover))}
          {stat('Giá trị hàng còn tồn', money(s.stockValue))}
        </div>
      </div>

      <div>
        <h2>{t('Dự báo hoà vốn')}</h2>
        <div className="stats">
          {stat('Doanh thu dự kiến nếu bán hết tồn', money(s.revenueIfSellAll))}
          {stat('Lãi/lỗ cuối cùng dự kiến', money(s.finalProjected))}
          {stat(
            'Doanh thu TB/ngày',
            s.avgDailyRevenue === null ? '—' : money(s.avgDailyRevenue),
            s.firstSale && s.lastSale ? `${formatDate(s.firstSale)} – ${formatDate(s.lastSale)}` : undefined,
          )}
          {stat(
            'Dự kiến ngày hoà vốn',
            s.breakEvenDate ? (
              <span className="positive">{t('Đã hoà vốn')}</span>
            ) : s.projectedBreakEven ? (
              formatDate(s.projectedBreakEven)
            ) : (
              '—'
            ),
            s.breakEvenDate ? formatDate(s.breakEvenDate) : undefined,
          )}
        </div>
      </div>
    </div>
  )
}
