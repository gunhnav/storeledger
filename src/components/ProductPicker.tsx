import { useState, type ReactNode } from 'react'
import { normalizeSearch } from '../lib/format'
import type { Product } from '../types/database'

type Props = {
  products: Product[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  // Thông tin phụ dưới tên món: giá, "Ở nhà: N"…
  renderInfo: (product: Product) => ReactNode
  // Nhãn trạng thái ở góc thẻ (ví dụ "Hết ở quầy"), null = không có
  renderBadge?: (product: Product) => ReactNode
  // Nhập nhanh: mỗi món một dòng có sẵn ô nhập (do trang vẽ), không cần tick
  quick: boolean
  onQuickChange: (quick: boolean) => void
  renderQuick: (product: Product) => ReactNode
}

// Danh sách món có tìm kiếm (không dấu), lọc theo nhóm, chạm thẻ để chọn nhiều hoặc nhập nhanh
export function ProductPicker({
  products,
  selectedIds,
  onChange,
  renderInfo,
  renderBadge,
  quick,
  onQuickChange,
  renderQuick,
}: Props) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  const categories = [...new Set(products.map((p) => p.category ?? '').filter((c) => c !== ''))].sort()
  const needle = normalizeSearch(search)
  const visible = products.filter(
    (p) =>
      (category === '' || p.category === category) &&
      (needle === '' || normalizeSearch(p.name).includes(needle)),
  )
  const selected = new Set(selectedIds)

  const toggle = (id: string) => {
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }

  const selectVisible = () => {
    onChange([...selectedIds, ...visible.map((p) => p.id).filter((id) => !selected.has(id))])
  }

  return (
    <div className="picker">
      <div className="picker-toolbar">
        <div className="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Tìm món (gõ không dấu cũng được)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Cách nhập">
          <button type="button" className={quick ? 'active' : undefined} onClick={() => onQuickChange(true)}>
            Nhập nhanh
          </button>
          <button type="button" className={quick ? undefined : 'active'} onClick={() => onQuickChange(false)}>
            Chọn món
          </button>
        </div>
      </div>

      {categories.length > 1 && (
        <div className="chips">
          {['', ...categories].map((c) => (
            <button
              key={c || '__all'}
              type="button"
              className={`chip${category === c ? ' active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c || 'Tất cả'}
            </button>
          ))}
        </div>
      )}

      <div className="picker-meta">
        <span className="muted">
          {visible.length} món{selectedIds.length > 0 && ` · đã chọn ${selectedIds.length}`}
        </span>
        {!quick && (
          <span className="picker-actions">
            <button type="button" className="link" onClick={selectVisible} disabled={visible.length === 0}>
              Chọn tất cả
            </button>
            <button type="button" className="link" onClick={() => onChange([])} disabled={selectedIds.length === 0}>
              Bỏ chọn
            </button>
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="picker-empty muted">Không có món nào khớp.</p>
      ) : quick ? (
        <ul className="quick-list">
          {visible.map((p) => (
            <li key={p.id} className={selected.has(p.id) ? 'selected' : undefined}>
              <div className="quick-name">
                <span className="product-name">{p.name}</span>
                <span className="product-info">{renderInfo(p)}</span>
              </div>
              {renderQuick(p)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="product-grid">
          {visible.map((p) => {
            const isSelected = selected.has(p.id)
            const badge = renderBadge?.(p)
            return (
              <button
                key={p.id}
                type="button"
                className={`product-card${isSelected ? ' selected' : ''}`}
                aria-pressed={isSelected}
                onClick={() => toggle(p.id)}
              >
                <span className="product-check" aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
                <span className="product-name">{p.name}</span>
                <span className="product-info">{renderInfo(p)}</span>
                {badge && <span className="product-badge">{badge}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Ô số lượng có nút − / +, giá trị dạng chuỗi để cho phép ô trống khi đang gõ
export function QtyStepper({
  value,
  onChange,
  min,
  label,
}: {
  value: string
  onChange: (value: string) => void
  min: number
  label: string
}) {
  const n = Number(value) || 0
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label={`Giảm ${label}`}
        onClick={() => onChange(String(Math.max(min, n - 1)))}
        disabled={n <= min}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
      />
      <button type="button" aria-label={`Tăng ${label}`} onClick={() => onChange(String(n + 1))}>
        +
      </button>
    </div>
  )
}
