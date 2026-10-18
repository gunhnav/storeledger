import { useState, type ReactNode } from 'react'
import { normalizeSearch } from '../lib/format'
import type { Product } from '../types/database'

type Props = {
  products: Product[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  // Thông tin phụ dưới tên món: giá, "Ở nhà: N"…
  renderInfo: (product: Product) => ReactNode
  // Nhập nhanh: mỗi món một dòng có sẵn ô nhập (do trang vẽ), không cần tick
  quick: boolean
  onQuickChange: (quick: boolean) => void
  renderQuick: (product: Product) => ReactNode
}

// Danh sách món có tìm kiếm (không dấu), lọc theo nhóm, tick chọn nhiều hoặc nhập nhanh
export function ProductPicker({
  products,
  selectedIds,
  onChange,
  renderInfo,
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
      <div className="mode-toggle" role="group" aria-label="Cách nhập">
        <button type="button" className={quick ? 'active' : undefined} onClick={() => onQuickChange(true)}>
          Nhập nhanh
        </button>
        <button type="button" className={quick ? undefined : 'active'} onClick={() => onQuickChange(false)}>
          Chọn món
        </button>
      </div>

      <input
        type="search"
        className="picker-search"
        placeholder="Tìm món (gõ không dấu cũng được)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

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

      {!quick && (
        <div className="row">
          <button type="button" onClick={selectVisible} disabled={visible.length === 0}>
            Chọn tất cả (đang lọc)
          </button>
          <button type="button" onClick={() => onChange([])} disabled={selectedIds.length === 0}>
            Bỏ chọn
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="muted">Không có món nào khớp.</p>
      ) : (
        <ul className="picker-list">
          {visible.map((p) =>
            quick ? (
              <li key={p.id} className={`picker-row quick${selected.has(p.id) ? ' selected' : ''}`}>
                <div className="picker-name">
                  {p.name}
                  <small className="muted">{renderInfo(p)}</small>
                </div>
                {renderQuick(p)}
              </li>
            ) : (
              <li key={p.id}>
                <label className={`picker-row${selected.has(p.id) ? ' selected' : ''}`}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <div className="picker-name">
                    {p.name}
                    <small className="muted">{renderInfo(p)}</small>
                  </div>
                </label>
              </li>
            ),
          )}
        </ul>
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
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
      />
      <button type="button" aria-label={`Tăng ${label}`} onClick={() => onChange(String(n + 1))}>
        +
      </button>
    </div>
  )
}
