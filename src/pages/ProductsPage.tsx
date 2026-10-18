import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { errorMessage, formatVND } from '../lib/format'
import type { Product } from '../types/database'

type FormValues = {
  name: string
  category: string
  sale_price: number
  app_price: number | null
  tracks_stock: boolean
  low_stock_threshold: number
  unit_cost: number | null
  is_active: boolean
}

type Row = Product & { unit_cost: number | null }

const EMPTY: FormValues = {
  name: '',
  category: '',
  sale_price: Number.NaN,
  app_price: null,
  tracks_stock: true,
  low_stock_threshold: 3,
  unit_cost: null,
  is_active: true,
}

// Ô số để trống thì thành null (giá app, giá vốn cố định là không bắt buộc)
const optionalNumber = (v: unknown) => (v === '' || v === null ? null : Number(v))

function saveError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    return 'Cửa hàng đã có sản phẩm trùng tên'
  }
  return errorMessage(error)
}

export function ProductsPage() {
  const { current } = useStore()
  return current ? <ProductsManager key={current.id} storeId={current.id} /> : null
}

// Chỉ admin (route bọc RequireAdmin, RLS cũng chặn ghi)
function ProductsManager({ storeId }: { storeId: string }) {
  const [list, setList] = useState<{ rows: Row[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<Row | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: EMPTY })
  const tracksStock = useWatch({ control, name: 'tracks_stock' })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('products').select('*').eq('store_id', storeId).order('name'),
      supabase.from('product_fixed_costs').select('*'),
    ]).then(([products, costs]) => {
      if (cancelled) return
      const costById = new Map((costs.data ?? []).map((c) => [c.product_id, c.unit_cost]))
      const error = products.error ?? costs.error
      setList({
        rows: (products.data ?? []).map((p) => ({ ...p, unit_cost: costById.get(p.id) ?? null })),
        error: error ? errorMessage(error) : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  const startEdit = (row: Row) => {
    setResult(null)
    setEditing(row)
    reset({
      name: row.name,
      category: row.category ?? '',
      sale_price: row.sale_price,
      app_price: row.app_price,
      tracks_stock: row.tracks_stock,
      low_stock_threshold: row.low_stock_threshold,
      unit_cost: row.unit_cost,
      is_active: row.is_active,
    })
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
      sale_price: values.sale_price,
      app_price: values.app_price,
      low_stock_threshold: values.low_stock_threshold,
      is_active: values.is_active,
    }

    let productId: string
    if (editing) {
      const { error } = await supabase.from('products').update(fields).eq('id', editing.id)
      if (error) return setResult({ ok: false, text: saveError(error) })
      productId = editing.id
    } else {
      const { data, error } = await supabase
        .from('products')
        .insert({ ...fields, store_id: storeId, tracks_stock: values.tracks_stock })
        .select('id')
        .single()
      if (error) return setResult({ ok: false, text: saveError(error) })
      productId = data.id
    }

    // Món không quản lý tồn kho cần giá vốn cố định thì mới bán được
    const tracks = editing ? editing.tracks_stock : values.tracks_stock
    if (!tracks && values.unit_cost !== null) {
      const { error } = await supabase
        .from('product_fixed_costs')
        .upsert({ product_id: productId, unit_cost: values.unit_cost })
      if (error) return setResult({ ok: false, text: errorMessage(error) })
    }

    setResult({ ok: true, text: `Đã lưu "${fields.name}"` })
    setEditing(null)
    reset(EMPTY)
    setVersion((v) => v + 1)
  }

  const showCost = editing ? !editing.tracks_stock : !tracksStock

  return (
    <section>
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

        <div className="row">
          <label>
            Giá bán tại quầy
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('sale_price', {
                valueAsNumber: true,
                validate: (v) => (Number.isFinite(v) && v >= 0) || 'Nhập giá bán hợp lệ',
              })}
            />
          </label>
          <label>
            Giá ShopeeFood (trống = giá quầy)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('app_price', {
                setValueAs: optionalNumber,
                validate: (v) => v === null || (Number.isFinite(v) && v >= 0) || 'Giá không hợp lệ',
              })}
            />
          </label>
        </div>
        {(errors.sale_price || errors.app_price) && (
          <p className="error">{errors.sale_price?.message ?? errors.app_price?.message}</p>
        )}

        <label className="check">
          <input type="checkbox" disabled={!!editing} {...register('tracks_stock')} />
          Đếm tồn kho: giá vốn theo từng đợt nhập hàng (bỏ chọn nếu là món làm tại chỗ, dùng giá vốn cố định)
        </label>
        {editing && (
          <small className="muted">Không đổi được cách tính giá vốn sau khi đã tạo sản phẩm.</small>
        )}

        {showCost ? (
          <label>
            Giá vốn cố định / phần (bắt buộc để bán được món này)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('unit_cost', {
                setValueAs: optionalNumber,
                validate: (v) =>
                  (v !== null && Number.isFinite(v) && v >= 0) ||
                  (editing?.unit_cost === null && v === null) ||
                  'Nhập giá vốn hợp lệ',
              })}
            />
          </label>
        ) : (
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
        {(errors.unit_cost || errors.low_stock_threshold) && (
          <p className="error">
            {errors.unit_cost?.message ?? errors.low_stock_threshold?.message}
          </p>
        )}

        <label className="check">
          <input type="checkbox" {...register('is_active')} />
          Đang bán (bỏ chọn để ẩn khỏi các form nhập liệu)
        </label>

        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
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

      <h2 className="section-title">Danh sách sản phẩm</h2>
      {!list ? (
        <p className="muted">Đang tải…</p>
      ) : list.error ? (
        <p className="error">{list.error}</p>
      ) : list.rows.length === 0 ? (
        <p className="muted">Chưa có sản phẩm nào. Thêm sản phẩm ở form phía trên.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th className="num">Giá quầy</th>
                <th className="num">Giá app</th>
                <th>Giá vốn</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id} className={row.is_active ? undefined : 'inactive'}>
                  <td>
                    {row.name}
                    {row.category && <small className="muted"> · {row.category}</small>}
                    {!row.is_active && <small className="muted"> · ngừng bán</small>}
                  </td>
                  <td className="num">{formatVND(row.sale_price)}</td>
                  <td className="num">{row.app_price === null ? '—' : formatVND(row.app_price)}</td>
                  <td>
                    {row.tracks_stock ? (
                      <span className="muted">Theo đợt nhập hàng</span>
                    ) : row.unit_cost === null ? (
                      <span className="badge badge-out">Thiếu giá vốn</span>
                    ) : (
                      `Cố định ${formatVND(row.unit_cost)}/phần`
                    )}
                  </td>
                  <td>
                    <button type="button" className="link" onClick={() => startEdit(row)}>
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
