import { useState } from 'react'
import { useStore } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { formatDate } from '../lib/format'
import { batchStats } from '../lib/analytics/batches'
import { salesPeriods, sellThrough, suggestNextBatch, type SuggestionBasis } from '../lib/analytics/bestSellers'
import { useAnalyticsData } from '../lib/useAnalyticsData'

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`)

export function BestSellersPage() {
  const { current } = useStore()
  return current ? <BestSellers key={current.id} storeId={current.id} /> : null
}

// Chỉ admin: bán chạy theo kỳ, tỷ lệ bán hết trong đợt, gợi ý nhập đợt sau
function BestSellers({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const { loading, error, data } = useAnalyticsData(storeId)
  const [planned, setPlanned] = useState('100')
  const [basis, setBasis] = useState<SuggestionBasis>('last')

  if (loading) return <p className="muted">{t('Đang tải…')}</p>
  if (error) return <p className="error">{t(error)}</p>
  if (!data) return null

  const stocked = data.input.products.filter((p) => p.tracksStock)
  const names = new Map(stocked.map((p) => [p.id, p.name]))
  const periods = salesPeriods(data.input, data.today)
  if (periods.length === 0) {
    return <p className="pos-empty muted">{t('Chưa có đợt nhập nào. Nhập hàng ở Kho hàng → Nhập hàng.')}</p>
  }
  const { batches } = batchStats(data.input, data.allocations, data.currentPrice, data.today)
  const rates = sellThrough(batches)
  const plannedTotal = Math.max(0, Math.floor(Number(planned) || 0))
  const suggestion = suggestNextBatch(
    periods,
    stocked.map((p) => p.id),
    plannedTotal,
    basis,
  )
  const batchIndex = new Map(batches.map((b, i) => [b.purchaseId, i + 1]))

  return (
    <section className="report-stack">
      <div>
        <h2>{t('Bán chạy theo kỳ')}</h2>
        <p className="muted section-note">
          {t('Kỳ của mỗi đợt tính từ ngày nhập đợt đó đến trước ngày nhập đợt sau (đợt cuối tính đến hôm nay).')}
        </p>
        <div className="table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th className="sticky-col">{t('Kỳ')}</th>
                {stocked.map((p) => (
                  <th key={p.id} className="num">
                    {p.name}
                  </th>
                ))}
                <th className="num">{t('Tổng')}</th>
                <th>{t('Bán chạy nhất')}</th>
                <th className="num">{t('Số hũ')}</th>
                <th className="num">{t('Tỷ trọng')}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.purchaseId}>
                  <td className="sticky-col">
                    <strong>{t('Đợt {n}', { n: batchIndex.get(period.purchaseId) ?? '' })}</strong> ·{' '}
                    {period.to < period.from ? formatDate(period.from) : `${formatDate(period.from)} – ${formatDate(period.to)}`}
                  </td>
                  {stocked.map((p) => (
                    <td key={p.id} className="num">
                      {period.sold[p.id] || <span className="zero">0</span>}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{period.total}</strong>
                  </td>
                  <td>{period.topProductId ? names.get(period.topProductId) : '—'}</td>
                  <td className="num">{period.topQty || '—'}</td>
                  <td className="num">{pct(period.topShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2>{t('Tỷ lệ bán hết trong đợt')}</h2>
        <p className="muted section-note">
          {t('Hũ đã bán của chính đợt đó (FIFO) chia cho hũ nhập đợt. Màu càng đậm là càng gần bán hết.')}
        </p>
        <div className="table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th className="sticky-col">{t('Đợt nhập')}</th>
                {stocked.map((p) => (
                  <th key={p.id} className="num">
                    {p.name}
                  </th>
                ))}
                <th>{t('Bán hết nhanh nhất')}</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((row) => (
                <tr key={row.purchaseId}>
                  <td className="sticky-col">
                    <strong>{t('Đợt {n}', { n: batchIndex.get(row.purchaseId) ?? '' })}</strong> ·{' '}
                    {formatDate(batches.find((b) => b.purchaseId === row.purchaseId)?.date ?? '')}
                  </td>
                  {stocked.map((p) => {
                    const rate = row.rates[p.id]
                    if (rate === undefined) return <td key={p.id} />
                    return (
                      <td
                        key={p.id}
                        className={`num heat${rate >= 0.6 ? ' heat-strong' : ''}`}
                        style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(rate * 85)}%, var(--surface))` }}
                      >
                        {pct(rate)}
                      </td>
                    )
                  })}
                  <td>{row.fastestProductId ? names.get(row.fastestProductId) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2>{t('Gợi ý nhập đợt sau')}</h2>
        <div className="card suggest-controls">
          <label className="field">
            {t('Tổng số hũ dự định nhập đợt sau')}
            <input
              type="text"
              inputMode="numeric"
              value={planned}
              onChange={(e) => setPlanned(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <div className="field">
            {t('Căn cứ')}
            <div className="segmented" role="radiogroup" aria-label={t('Căn cứ')}>
              {(['last', 'all'] as SuggestionBasis[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={basis === value}
                  className={basis === value ? 'active' : undefined}
                  onClick={() => setBasis(value)}
                >
                  {value === 'last' ? t('Đợt gần nhất') : t('Tất cả các đợt')}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!suggestion ? (
          <p className="pos-empty muted">{t('Chưa có số liệu bán để gợi ý.')}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">{t('Hạng')}</th>
                    <th>{t('Loại')}</th>
                    <th className="num">{t('Đã bán')}</th>
                    <th className="num">{t('Tỷ trọng')}</th>
                    <th className="num">{t('Gợi ý nhập')}</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestion.map((row) => (
                    <tr key={row.productId}>
                      <td className="num">#{row.rank}</td>
                      <td>{names.get(row.productId)}</td>
                      <td className="num">{row.sold}</td>
                      <td className="num">{pct(row.share)}</td>
                      <td className="num">
                        <strong>{row.suggested}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="success">
              {t('Loại bán chạy nhất: {name} → nên nhập nhiều nhất', { name: names.get(suggestion[0].productId) ?? '' })}
            </p>
            <p className="muted section-note">{t('Tổng gợi ý có thể lệch vài hũ so với tổng dự định do làm tròn.')}</p>
          </>
        )}
      </div>
    </section>
  )
}
