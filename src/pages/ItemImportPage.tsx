import { useEffect, useState } from 'react'
import { ImportItems } from '../components/ImportItems'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { errorMessage, formatDate, formatVND } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'

type Period = { start: string; end: string; items: number; qty: number; net: number }

// Nhập mặt hàng (mục Nhập liệu): tải file báo cáo mặt hàng của máy POS (một ngày hoặc cả tháng) và xem các khoảng đã nhập.
// Phần thống kê mặt hàng nằm ở mục Báo cáo.
export function ItemImportPage() {
  const { current } = useStore()
  return current ? <ItemImport key={current.id} storeId={current.id} /> : null
}

function ItemImport({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const [periods, setPeriods] = useState<Period[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchAll((a, b) =>
      supabase.from('monthly_item_sales').select('period_start, period_end, qty, net, item_code').eq('store_id', storeId).order('period_start', { ascending: false }).order('item_code').range(a, b),
    )
      .then((rows) => {
        if (cancelled) return
        const map = new Map<string, Period>()
        for (const r of rows) {
          const key = `${r.period_start}|${r.period_end}`
          const p = map.get(key) ?? { start: r.period_start, end: r.period_end, items: 0, qty: 0, net: 0 }
          p.items += 1
          p.qty += Number(r.qty)
          p.net += Number(r.net)
          map.set(key, p)
        }
        setPeriods([...map.values()])
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  return (
    <section>
      <h2>{t('Nhập mặt hàng đã bán')}</h2>
      <ImportItems storeId={storeId} onDone={() => setVersion((v) => v + 1)} />

      <h2>{t('Các khoảng ngày đã nhập')}</h2>
      {error ? (
        <p className="error">{t(error)}</p>
      ) : !periods ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : periods.length === 0 ? (
        <p className="muted">{t('Chưa nhập báo cáo mặt hàng nào.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Khoảng ngày')}</th>
                <th className="num">{t('Số mặt hàng')}</th>
                <th className="num">{t('Số phần')}</th>
                <th className="num">{t('Doanh thu')}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={`${p.start}|${p.end}`}>
                  <td>{p.start === p.end ? formatDate(p.start) : `${formatDate(p.start)} – ${formatDate(p.end)}`}</td>
                  <td className="num">{p.items}</td>
                  <td className="num">{new Intl.NumberFormat('vi-VN').format(p.qty)}</td>
                  <td className="num">{formatVND(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
