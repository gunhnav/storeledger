import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { errorMessage, formatVND, todayVN } from '../lib/format'

type Line = { product_id: string; quantity: number; unit_cost: number }
type FormValues = { purchase_date: string; note: string; items: Line[] }

const EMPTY_LINE: Line = { product_id: '', quantity: 1, unit_cost: 0 }

export function PurchasePage() {
  const { current } = useStore()
  return current ? <PurchaseForm key={current.id} storeId={current.id} /> : null
}

// Nhân viên cũng nhập được, nhưng không bao giờ xem được lịch sử giá nhập
function PurchaseForm({ storeId }: { storeId: string }) {
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { purchase_date: todayVN(), note: '', items: [EMPTY_LINE] },
  })
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
    rules: { minLength: { value: 1, message: 'Đợt nhập phải có ít nhất một sản phẩm' } },
  })

  const stocked = products.filter((p) => p.tracks_stock)
  const items = useWatch({ control, name: 'items' })
  const total = items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unit_cost || 0), 0)

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    const { error } = await supabase.rpc('create_purchase', {
      p_store_id: storeId,
      p_purchase_date: values.purchase_date || null,
      p_note: values.note.trim() || null,
      p_items: values.items,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    setResult({ ok: true, text: `Đã lưu đợt nhập ${formatVND(total)}` })
    reset({ purchase_date: values.purchase_date, note: '', items: [EMPTY_LINE] })
    reload()
  }

  if (loading) return <p className="muted">Đang tải sản phẩm…</p>
  if (error) return <p className="error">{error}</p>

  return (
    <section>
      <h2>Nhập hàng</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <label>
          Ngày nhập
          <input type="date" {...register('purchase_date', { required: true })} />
        </label>

        {fields.map((field, index) => {
          const productId = items[index]?.product_id
          const row = productId ? stock.get(productId) : undefined
          const lineErrors = errors.items?.[index]
          return (
            <fieldset key={field.id} className="line">
              <label className="grow">
                Sản phẩm
                <select {...register(`items.${index}.product_id`, { required: 'Chọn sản phẩm' })}>
                  <option value="">— Chọn sản phẩm —</option>
                  {stocked.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {productId && <small className="muted">Ở nhà: {row?.qty_home ?? 0}</small>}
              </label>
              <label className="qty">
                Số lượng
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  {...register(`items.${index}.quantity`, {
                    valueAsNumber: true,
                    validate: (v) => (Number.isInteger(v) && v > 0) || 'Số nguyên > 0',
                  })}
                />
              </label>
              <label className="money">
                Giá nhập/đơn vị
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="any"
                  {...register(`items.${index}.unit_cost`, {
                    valueAsNumber: true,
                    validate: (v) => (Number.isFinite(v) && v >= 0) || 'Không hợp lệ',
                  })}
                />
              </label>
              <button
                type="button"
                className="link"
                aria-label="Xoá dòng"
                onClick={() => remove(index)}
              >
                Xoá
              </button>
              {lineErrors && (
                <p className="error full">
                  {lineErrors.product_id?.message ??
                    lineErrors.quantity?.message ??
                    lineErrors.unit_cost?.message}
                </p>
              )}
            </fieldset>
          )
        })}
        {errors.items?.root && <p className="error">{errors.items.root.message}</p>}

        <button type="button" onClick={() => append(EMPTY_LINE)}>
          + Thêm sản phẩm
        </button>

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        <p className="total">
          Tổng tiền nhập: <strong>{formatVND(total)}</strong>
        </p>

        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang lưu…' : 'Lưu đợt nhập'}
        </button>
      </form>
    </section>
  )
}
