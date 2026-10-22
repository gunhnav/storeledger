import { useI18n } from '../lib/i18n'
import { formatDate } from '../lib/format'
import { daysLeft, formatQty, ingredientStatus } from '../lib/ingredients'
import type { IngredientStockRow } from '../types/database'

// Bảng tồn nguyên liệu: còn lại = tổng nhập - Σ(số phần đã bán × định lượng); "dùng được" theo tốc độ dùng gần đây
export function IngredientStockTable({ rows, recentDays }: { rows: IngredientStockRow[]; recentDays: number }) {
  const { t } = useI18n()
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('Nguyên liệu')}</th>
            <th className="num">{t('Đã nhập')}</th>
            <th className="num">{t('Đã dùng (theo doanh thu)')}</th>
            <th className="num">{t('Còn lại')}</th>
            <th className="num">{t('Dùng được')}</th>
            <th>{t('Nhập gần nhất')}</th>
            <th>{t('Trạng thái')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const status = ingredientStatus(g.on_hand, g.low_stock_threshold)
            const left = daysLeft(g.on_hand, g.used_recent, recentDays)
            return (
              <tr key={g.ingredient_id}>
                <td>{g.name}</td>
                <td className="num">{formatQty(g.received)}</td>
                <td className="num">{formatQty(g.used)}</td>
                <td className="num">
                  <strong>
                    {formatQty(g.on_hand)} {g.unit}
                  </strong>
                </td>
                <td className="num">{left === null ? '—' : t('~{days} ngày', { days: left })}</td>
                <td>{g.last_receipt ? formatDate(g.last_receipt) : '—'}</td>
                <td>
                  <span className={`badge ${status === 'ok' ? 'badge-ok' : status === 'low' ? 'badge-warn' : 'badge-bad'}`}>
                    {status === 'ok' ? t('Ổn') : status === 'low' ? t('Sắp hết') : status === 'out' ? t('Hết') : t('Kiểm tra')}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
