import { DatePicker } from './DatePicker'
import { useI18n } from '../lib/i18n'
import { initialPeriod, type PeriodState } from '../lib/period'
import type { Preset } from '../lib/bundauReport'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: 'month', label: 'Tháng này' },
  { value: 'lastMonth', label: 'Tháng trước' },
]

// Chọn khoảng thời gian cho báo cáo: nút nhanh (hôm nay, 7 ngày, tháng này, tháng trước) hoặc chọn từ ngày - đến ngày
export function PeriodFilters({ value, today, onChange }: { value: PeriodState; today: string; onChange: (v: PeriodState) => void }) {
  const { t } = useI18n()
  return (
    <div className="filters">
      <div className="preset-chips" role="group" aria-label={t('Khoảng thời gian')}>
        {PRESETS.map((p) => (
          <button key={p.value} type="button" className={value.preset === p.value ? 'active' : undefined} onClick={() => onChange(initialPeriod(p.value, today))}>
            {t(p.label)}
          </button>
        ))}
      </div>
      <div className="field">
        {t('Từ ngày')}
        <DatePicker value={value.range.from} onChange={(v) => onChange({ preset: 'custom', range: { ...value.range, from: v } })} label={t('Từ ngày')} />
      </div>
      <div className="field">
        {t('Đến ngày')}
        <DatePicker value={value.range.to} onChange={(v) => onChange({ preset: 'custom', range: { ...value.range, to: v } })} label={t('Đến ngày')} />
      </div>
    </div>
  )
}
