import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { errorMessage, todayVN } from '../lib/format'

type FormValues = { product_id: string; quantity: number; transfer_date: string; note: string }

export function TransferPage() {
  const { current } = useStore()
  return current ? <TransferForm key={current.id} storeId={current.id} /> : null
}

function TransferForm({ storeId }: { storeId: string }) {
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { product_id: '', quantity: 1, transfer_date: todayVN(), note: '' },
  })

  const stocked = products.filter((p) => p.tracks_stock)
  const productId = useWatch({ control, name: 'product_id' })
  const row = productId ? stock.get(productId) : undefined

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    const { error } = await supabase.rpc('create_transfer', {
      p_store_id: storeId,
      p_product_id: values.product_id,
      p_quantity: values.quantity,
      p_transfer_date: values.transfer_date || null,
      p_note: values.note.trim() || null,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    const name = stocked.find((p) => p.id === values.product_id)?.name ?? ''
    setResult({ ok: true, text: `Đã chuyển ${values.quantity} "${name}" ra quầy` })
    reset({ product_id: '', quantity: 1, transfer_date: values.transfer_date, note: '' })
    reload()
  }

  if (loading) return <p className="muted">Đang tải sản phẩm…</p>
  if (error) return <p className="error">{error}</p>

  return (
    <section>
      <h2>Chuyển hàng ra quầy</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <label>
          Sản phẩm
          <select {...register('product_id', { required: 'Chọn sản phẩm' })}>
            <option value="">— Chọn sản phẩm —</option>
            {stocked.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {productId && (
            <small className="muted">
              Ở nhà: {row?.qty_home ?? 0} · Ở quầy: {row?.qty_shop ?? 0}
            </small>
          )}
        </label>
        {errors.product_id && <p className="error">{errors.product_id.message}</p>}

        <div className="row">
          <label>
            Số lượng
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              {...register('quantity', {
                valueAsNumber: true,
                validate: (v) => (Number.isInteger(v) && v > 0) || 'Số lượng phải là số nguyên > 0',
              })}
            />
          </label>
          <label>
            Ngày chuyển
            <input type="date" {...register('transfer_date', { required: true })} />
          </label>
        </div>
        {errors.quantity && <p className="error">{errors.quantity.message}</p>}

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang lưu…' : 'Chuyển hàng'}
        </button>
      </form>
    </section>
  )
}
