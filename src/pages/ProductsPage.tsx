import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { errorMessage, formatDate, formatVND, todayVN } from '../lib/format'
import type { Product, ProductPrice, StorePriceRow } from '../types/database'

type FormValues = {
  name: string
  category: string
  tracks_stock: boolean
  low_stock_threshold: number
  is_active: boolean
  // Chỉ dùng khi thêm mới: tạo dòng giá ban đầu với ngày áp dụng hôm nay
  sale_price: number
  app_price: number | null
  unit_cost: number
}

type PriceValues = {
  effective_from: string
  sale_price: number
  app_price: number | null
  unit_cost: number
  note: string
}

type Catalog = {
  products: Product[]
  // Giá bán đang áp dụng hôm nay (get_store_prices)
  prices: Map<string, StorePriceRow>
  // Toàn bộ lịch sử giá của cửa hàng, mới nhất trước (product_prices, chỉ admin)
  history: ProductPrice[]
  error: string | null
}

const EMPTY: FormValues = {
  name: '',
  category: '',
  tracks_stock: true,
  low_stock_threshold: 3,
  is_active: true,
  sale_price: Number.NaN,
  app_price: null,
  unit_cost: Number.NaN,
}

// Ô số để trống thì thành null (giá app là không bắt buộc)
const optionalNumber = (v: unknown) => (v === '' || v === null ? null : Number(v))

const money = (v: number) => (Number.isFinite(v) && v >= 0) || 'Nhập số tiền hợp lệ'
const optionalMoney = (v: number | null) => v === null || money(v)

function saveError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    return 'Cửa hàng đã có sản phẩm trùng tên'
  }
  return errorMessage(error)
}

// Dòng giá có hiệu lực vào ngày `date` (history đã sắp mới nhất trước)
function effectiveAt(history: ProductPrice[], productId: string, date: string) {
  return history.find((r) => r.product_id === productId && r.effective_from <= date)
}

export function ProductsPage() {
  const { current } = useStore()
  return current ? <ProductsManager key={current.id} storeId={current.id} /> : null
}

// Chỉ admin (route bọc RequireAdmin, RLS cũng chặn ghi)
function ProductsManager({ storeId }: { storeId: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<Product | null>(null)
  const [pricing, setPricing] = useState<Product | null>(null)
  const [bulk, setBulk] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY })
  const tracksStock = useWatch({ control, name: 'tracks_stock' })
  const today = todayVN()

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('products').select('*').eq('store_id', storeId).order('name'),
      supabase.rpc('get_store_prices', { p_store_id: storeId, p_date: today }),
    ]).then(async ([products, prices]) => {
      const ids = (products.data ?? []).map((p) => p.id)
      const history =
        ids.length === 0
          ? { data: [] as ProductPrice[], error: null }
          : await supabase
              .from('product_prices')
              .select('*')
              .in('product_id', ids)
              .order('effective_from', { ascending: false })
      if (cancelled) return
      const error = products.error ?? prices.error ?? history.error
      setCatalog({
        products: products.data ?? [],
        prices: new Map((prices.data ?? []).map((r) => [r.product_id, r])),
        history: history.data ?? [],
        error: error ? errorMessage(error) : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, version, today])

  const refresh = () => setVersion((v) => v + 1)

  const startEdit = (row: Product) => {
    setResult(null)
    setPricing(null)
    setBulk(false)
    setEditing(row)
    reset({
      ...EMPTY,
      name: row.name,
      category: row.category ?? '',
      tracks_stock: row.tracks_stock,
      low_stock_threshold: row.low_stock_threshold,
      is_active: row.is_active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startPricing = (row: Product) => {
    setResult(null)
    setEditing(null)
    setBulk(false)
    reset(EMPTY)
    setPricing(row)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditing(null)
    reset(EMPTY)
  }

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    const fields = {
      name: values.name.trim(),
      category: values.category.trim() || null,
      low_stock_threshold: values.low_stock_threshold,
      is_active: values.is_active,
    }

    if (editing) {
      const { error } = await supabase.from('products').update(fields).eq('id', editing.id)
      if (error) return setResult({ ok: false, text: saveError(error) })
    } else {
      const { data, error } = await supabase
        .from('products')
        .insert({ ...fields, store_id: storeId, tracks_stock: values.tracks_stock })
        .select('id')
        .single()
      if (error) return setResult({ ok: false, text: saveError(error) })
      const { error: priceError } = await supabase.rpc('set_product_price', {
        p_product_id: data.id,
        p_effective_from: today,
        p_sale_price: values.sale_price,
        p_app_price: values.app_price,
        p_unit_cost: values.unit_cost,
        p_note: 'Giá ban đầu',
      })
      if (priceError) {
        refresh()
        return setResult({
          ok: false,
          text: `Đã tạo "${fields.name}" nhưng chưa lưu được giá: ${errorMessage(priceError)}. Bấm "Đổi giá" để nhập lại.`,
        })
      }
    }

    setResult({ ok: true, text: `Đã lưu "${fields.name}"` })
    setEditing(null)
    reset(EMPTY)
    refresh()
  }

  if (!catalog) return <p className="muted">Đang tải…</p>
  if (catalog.error) return <p className="error">{catalog.error}</p>

  return (
    <section>
      {pricing ? (
        <PriceEditor
          product={pricing}
          history={catalog.history.filter((r) => r.product_id === pricing.id)}
          onDone={(text) => {
            setPricing(null)
            setResult({ ok: true, text })
            refresh()
          }}
          onCancel={() => setPricing(null)}
        />
      ) : bulk ? (
        <BulkCostEditor
          products={catalog.products}
          history={catalog.history}
          onDone={(text, ok) => {
            setBulk(false)
            setResult({ ok, text })
            refresh()
          }}
          onCancel={() => setBulk(false)}
        />
      ) : (
        <>
          <h2>{editing ? `Sửa sản phẩm: ${editing.name}` : 'Thêm sản phẩm'}</h2>
          <form className="card form" onSubmit={handleSubmit(onSubmit)}>
            <div className="row">
              <label>
                Tên sản phẩm
                <input
                  type="text"
                  {...register('name', { validate: (v) => v.trim() !== '' || 'Nhập tên sản phẩm' })}
                />
              </label>
              <label>
                Nhóm (không bắt buộc)
                <input type="text" {...register('category')} />
              </label>
            </div>
            {errors.name && <p className="error">{errors.name.message}</p>}

            {editing ? (
              <small className="muted">Đổi giá bằng nút "Đổi giá" trong danh sách để giữ lịch sử giá.</small>
            ) : (
              <>
                <div className="row">
                  <label>
                    Giá bán tại quầy
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      {...register('sale_price', { valueAsNumber: true, validate: money })}
                    />
                  </label>
                  <label>
                    Giá ShopeeFood (trống = giá quầy)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      {...register('app_price', { setValueAs: optionalNumber, validate: optionalMoney })}
                    />
                  </label>
                  <label>
                    Giá vốn / đơn vị
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      {...register('unit_cost', { valueAsNumber: true, validate: money })}
                    />
                  </label>
                </div>
                {(errors.sale_price || errors.app_price || errors.unit_cost) && (
                  <p className="error">
                    {errors.sale_price?.message ?? errors.app_price?.message ?? errors.unit_cost?.message}
                  </p>
                )}
              </>
            )}

            <label className="check">
              <input type="checkbox" disabled={!!editing} {...register('tracks_stock')} />
              Đếm tồn kho: giá vốn theo từng đợt nhập hàng (bỏ chọn nếu là món làm tại chỗ, giá vốn
              theo lịch sử giá)
            </label>
            {editing && (
              <small className="muted">Không đổi được cách tính giá vốn sau khi đã tạo sản phẩm.</small>
            )}

            {(editing ? editing.tracks_stock : tracksStock) && (
              <label>
                Báo sắp hết khi tổng tồn ≤
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  {...register('low_stock_threshold', {
                    valueAsNumber: true,
                    validate: (v) => (Number.isInteger(v) && v >= 0) || 'Số nguyên ≥ 0',
                  })}
                />
              </label>
            )}
            {errors.low_stock_threshold && (
              <p className="error">{errors.low_stock_threshold.message}</p>
            )}

            <label className="check">
              <input type="checkbox" {...register('is_active')} />
              Đang bán (bỏ chọn để ẩn khỏi các form nhập liệu)
            </label>

            <div className="row">
              <button type="submit" className="primary" disabled={isSubmitting}>
                {isSubmitting ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm sản phẩm'}
              </button>
              {editing && (
                <button type="button" onClick={cancelEdit}>
                  Huỷ
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}

      <div className="row section-title">
        <h2>Danh sách sản phẩm</h2>
        <span className="spacer" />
        {!bulk && (
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setEditing(null)
              setPricing(null)
              reset(EMPTY)
              setBulk(true)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            Đổi giá vốn hàng loạt
          </button>
        )}
      </div>
      {catalog.products.length === 0 ? (
        <p className="muted">Chưa có sản phẩm nào. Thêm sản phẩm ở form phía trên.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th className="num">Giá quầy</th>
                <th className="num">Giá app</th>
                <th className="num">Giá vốn</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalog.products.map((row) => {
                const price = catalog.prices.get(row.id)
                const cost = effectiveAt(catalog.history, row.id, today)?.unit_cost ?? null
                return (
                  <tr key={row.id} className={row.is_active ? undefined : 'inactive'}>
                    <td>
                      {row.name}
                      {row.category && <small className="muted"> · {row.category}</small>}
                      {!row.is_active && <small className="muted"> · ngừng bán</small>}
                    </td>
                    <td className="num">{price ? formatVND(price.sale_price) : '—'}</td>
                    <td className="num">
                      {price?.app_price === null || !price ? '—' : formatVND(price.app_price)}
                    </td>
                    <td className="num">
                      {cost === null ? (
                        <span className="badge badge-out">Thiếu giá vốn</span>
                      ) : (
                        formatVND(cost)
                      )}
                    </td>
                    <td className="actions">
                      <button type="button" className="link" onClick={() => startPricing(row)}>
                        Đổi giá
                      </button>
                      <button type="button" className="link" onClick={() => startEdit(row)}>
                        Sửa
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Đổi giá một sản phẩm + lịch sử giá
// ---------------------------------------------------------------------------

function PriceEditor({
  product,
  history,
  onDone,
  onCancel,
}: {
  product: Product
  history: ProductPrice[]
  onDone: (text: string) => void
  onCancel: () => void
}) {
  const today = todayVN()
  const current = history.find((r) => r.effective_from <= today) ?? history[0]
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PriceValues>({
    defaultValues: {
      effective_from: today,
      sale_price: current?.sale_price ?? Number.NaN,
      app_price: current?.app_price ?? null,
      unit_cost: current?.unit_cost ?? Number.NaN,
      note: '',
    },
  })

  const onSubmit = async (values: PriceValues) => {
    setError(null)
    const { error } = await supabase.rpc('set_product_price', {
      p_product_id: product.id,
      p_effective_from: values.effective_from,
      p_sale_price: values.sale_price,
      p_app_price: values.app_price,
      p_unit_cost: values.unit_cost,
      p_note: values.note.trim() || null,
    })
    if (error) return setError(errorMessage(error))
    onDone(`Đã lưu giá "${product.name}" áp dụng từ ${formatDate(values.effective_from)}`)
  }

  return (
    <>
      <h2>Đổi giá: {product.name}</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <label>
          Ngày áp dụng
          <input type="date" {...register('effective_from', { required: 'Chọn ngày áp dụng' })} />
        </label>
        <small className="muted">
          Chọn được ngày quá khứ hoặc tương lai. Trùng ngày đã có thì ghi đè dòng giá ngày đó. Đơn bán,
          đợt nhập đã lưu không bị tính lại.
        </small>
        <div className="row">
          <label>
            Giá bán tại quầy
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('sale_price', { valueAsNumber: true, validate: money })}
            />
          </label>
          <label>
            Giá ShopeeFood (trống = giá quầy)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('app_price', { setValueAs: optionalNumber, validate: optionalMoney })}
            />
          </label>
          <label>
            Giá vốn / đơn vị
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('unit_cost', { valueAsNumber: true, validate: money })}
            />
          </label>
        </div>
        {(errors.effective_from || errors.sale_price || errors.app_price || errors.unit_cost) && (
          <p className="error">
            {errors.effective_from?.message ??
              errors.sale_price?.message ??
              errors.app_price?.message ??
              errors.unit_cost?.message}
          </p>
        )}
        <label>
          Ghi chú (ví dụ: NCC giảm giá)
          <input type="text" {...register('note')} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Đang lưu…' : 'Lưu giá'}
          </button>
          <button type="button" onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </form>

      <h2 className="section-title">Lịch sử giá</h2>
      {history.length === 0 ? (
        <p className="muted">Chưa có dòng giá nào.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Áp dụng từ</th>
                <th className="num">Giá quầy</th>
                <th className="num">Giá app</th>
                <th className="num">Giá vốn</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.effective_from)}</td>
                  <td className="num">{formatVND(r.sale_price)}</td>
                  <td className="num">{r.app_price === null ? '—' : formatVND(r.app_price)}</td>
                  <td className="num">{r.unit_cost === null ? '—' : formatVND(r.unit_cost)}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Đổi giá vốn hàng loạt: giữ nguyên giá bán đang hiệu lực vào ngày áp dụng
// ---------------------------------------------------------------------------

function BulkCostEditor({
  products,
  history,
  onDone,
  onCancel,
}: {
  products: Product[]
  history: ProductPrice[]
  onDone: (text: string, ok: boolean) => void
  onCancel: () => void
}) {
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(todayVN)
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Giá vốn mới người dùng gõ; chưa gõ thì hiện giá vốn đang hiệu lực
  const [costs, setCosts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories = [...new Set(products.map((p) => p.category ?? '').filter((c) => c !== ''))].sort()
  const visible = products.filter((p) => p.is_active && (category === '' || p.category === category))

  const costText = (id: string) => {
    if (id in costs) return costs[id]
    const cost = effectiveAt(history, id, date)?.unit_cost
    return cost === null || cost === undefined ? '' : String(cost)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const p of visible) {
        if (allVisibleSelected) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  const save = async () => {
    setError(null)
    const chosen = products.filter((p) => selected.has(p.id))
    if (chosen.length === 0) return setError('Chưa chọn món nào')
    if (!date) return setError('Chọn ngày áp dụng')

    // Kiểm tra hết trước khi ghi
    const plans: { product: Product; sale: number; app: number | null; cost: number }[] = []
    for (const product of chosen) {
      const text = costText(product.id).trim()
      const cost = Number(text)
      if (text === '' || !Number.isFinite(cost) || cost < 0) {
        return setError(`Giá vốn của "${product.name}" chưa hợp lệ`)
      }
      const base = effectiveAt(history, product.id, date)
      if (!base) {
        return setError(`"${product.name}" chưa có giá bán vào ngày ${formatDate(date)}, đổi giá riêng món này`)
      }
      plans.push({ product, sale: base.sale_price, app: base.app_price, cost })
    }

    setSaving(true)
    const failed: string[] = []
    for (const plan of plans) {
      const { error } = await supabase.rpc('set_product_price', {
        p_product_id: plan.product.id,
        p_effective_from: date,
        p_sale_price: plan.sale,
        p_app_price: plan.app,
        p_unit_cost: plan.cost,
        p_note: note.trim() || null,
      })
      if (error) failed.push(`${plan.product.name}: ${errorMessage(error)}`)
    }
    setSaving(false)

    const okCount = plans.length - failed.length
    if (failed.length > 0) {
      onDone(`Đã lưu ${okCount}/${plans.length} món. Lỗi: ${failed.join('; ')}`, false)
    } else {
      onDone(`Đã lưu giá vốn ${okCount} món, áp dụng từ ${formatDate(date)}`, true)
    }
  }

  return (
    <>
      <h2>Đổi giá vốn hàng loạt</h2>
      <div className="card form">
        <div className="row">
          <label>
            Nhóm
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Tất cả</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ngày áp dụng
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label>
          Ghi chú chung
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <small className="muted">
          Giá bán và giá app giữ nguyên theo giá đang hiệu lực vào ngày áp dụng. Ô giá vốn điền sẵn giá
          vốn hiện hành, trống là món chưa có giá vốn.
        </small>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả món đang lọc"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th>Sản phẩm</th>
                <th className="num">Giá vốn mới</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${p.name}`}
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td>
                    {p.name}
                    {p.category && <small className="muted"> · {p.category}</small>}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      className="cost-input"
                      aria-label={`Giá vốn mới của ${p.name}`}
                      value={costText(p.id)}
                      onChange={(e) => {
                        const value = e.target.value
                        setCosts((prev) => ({ ...prev, [p.id]: value }))
                        if (!selected.has(p.id)) toggle(p.id)
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? 'Đang lưu…' : `Lưu giá vốn (${selected.size} món)`}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}>
            Huỷ
          </button>
        </div>
      </div>
    </>
  )
}
