import type { Store } from '../types/database'
import { Icon } from './Icon'

// Chữ viết tắt của quán: chữ cái đầu của 2 từ đầu ("Hogi Food" → "HF")
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase('vi'))
    .join('')
}

type Props = {
  stores: Store[]
  selected: string[]
  onToggle: (storeId: string) => void
  disabled?: boolean
  // Bản gọn dùng trong bảng
  compact?: boolean
  // Nhãn đọc màn hình cho từng thẻ, ví dụ "An làm tại Hogi Food"
  ariaLabel?: (store: Store) => string
}

// Chọn nhiều quán dạng thẻ bấm: logo chữ tắt + tên, dấu tích khi đã chọn
export function StorePicker({ stores, selected, onToggle, disabled, compact, ariaLabel }: Props) {
  return (
    <div className={compact ? 'store-picker compact' : 'store-picker'}>
      {stores.map((s, i) => {
        const on = selected.includes(s.id)
        return (
          <button
            key={s.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={ariaLabel?.(s)}
            className={on ? 'store-card on' : 'store-card'}
            disabled={disabled}
            onClick={() => onToggle(s.id)}
          >
            <span className={`store-logo tone-${i % 4}`}>{initials(s.name)}</span>
            <span className="store-card-name">{s.name}</span>
            <span className="store-check">{on && <Icon name="check" size={compact ? 12 : 14} />}</span>
          </button>
        )
      })}
    </div>
  )
}
