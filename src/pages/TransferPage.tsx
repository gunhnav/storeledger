import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { MAX_QTY, errorMessage, notFuture, todayVN } from '../lib/format'
import type { Product } from '../types/database'

type FormValues = { transfer_date: string; note: string }
type Line = { product_id: string; qty: string }

// Cửa hàng ít món thì mặc định nhập nhanh
const QUICK_MAX = 10

export function TransferPage() {
  const { current } = useStore()
  return current ? <TransferForm key={current.id} storeId={current.id} /> : null
}

function TransferForm({ storeId }: { storeId: string }) {
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [lines, setLines] = useState<Line[]>([])
  const [quickMode, setQuickMode] = useState<boolean | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { transfer_date: todayVN(), note: '' } })

  const stocked = products.filter((p) => p.tracks_stock)
  const quick = quickMode ?? stocked.length <= QUICK_MAX
  const byId = new Map(stocked.map((p) => [p.id, p]))

  // Chuyển nhiều hơn số ở nhà thì cảnh báo và không cho lưu
  const overHome = (line: Line) => {
    const home = stock.get(line.product_id)?.qty_home ?? 0
    if ((Number(line.qty) || 0) <= home) return null
    return home === 0 ? 'Ở nhà hết hàng: nhập hàng trước' : `Vượt số ở nhà (còn ${home})`
  }

  const onPick = (ids: string[]) => {
    setLines((ls) => [
      ...ls.filter((l) => ids.includes(l.product_id)),
      ...ids
        .filter((id) => !ls.some((l) => l.product_id === id))
        .map((id) => ({ product_id: id, qty: '1' })),
    ])
  }

  // Nhập nhanh: ô trống hoặc 0 thì bỏ món; chọn món: giữ dòng, chỉ đổi số
  const setQty = (id: string, qty: string) => {
    setLines((ls) => {
      if (quick && (Number(qty) || 0) <= 0) return ls.filter((l) => l.product_id !== id)
      if (ls.some((l) => l.product_id === id)) {
        return ls.map((l) => (l.product_id === id ? { ...l, qty } : l))
      }
      return [...ls, { product_id: id, qty }]
    })
  }

  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.product_id !== id))

  // DB chỉ có create_transfer cho từng món nên gọi lần lượt; món lỗi giữ lại trong form để lưu lại
  const onSubmit = async (values: FormValues) => {
    setResult(null)
    setFormError(null)
    if (lines.length === 0) return setFormError('Chưa chọn món nào')
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(`Số lượng của "${name}" phải là số nguyên > 0`)
      }
      if (quantity > MAX_QTY) return setFormError(`Số lượng của "${name}" quá lớn, kiểm tra lại`)
      const warn = overHome(line)
      if (warn) return setFormError(`"${name}": ${warn}`)
    }

    const done: string[] = []
    const failed: { line: Line; message: string }[] = []
    for (const line of lines) {
      const { error } = await supabase.rpc('create_transfer', {
        p_store_id: storeId,
        p_product_id: line.product_id,
        p_quantity: Number(line.qty),
        p_transfer_date: values.transfer_date || null,
        p_note: values.note.trim() || null,
      })
      const name = byId.get(line.product_id)?.name ?? ''
      if (error) failed.push({ line, message: `${name}: ${errorMessage(error)}` })
      else done.push(`${line.qty} ${name}`)
    }

    reload()
    if (failed.length === 0) {
      setResult({ ok: true, text: `Đã chuyển ra quầy: ${done.join(', ')}` })
      reset({ transfer_date: values.transfer_date, note: '' })
      setLines([])
      return
    }
    setLines(failed.map((f) => f.line))
    setResult({
      ok: false,
      text:
        (done.length > 0 ? `Đã chuyển: ${done.join(', ')}. ` : '') +
        `Chưa chuyển (còn trong form để lưu lại): ${failed.map((f) => f.message).join('; ')}`,
    })
  }

  if (loading) return <p className="muted">Đang tải sản phẩm…</p>
  if (error) return <p className="error">{error}</p>

  const info = (p: Product) => {
    const row = stock.get(p.id)
    return `Ở nhà: ${row?.qty_home ?? 0} · Ở quầy: ${row?.qty_shop ?? 0}`
  }
  const lineFor = (id: string) => lines.find((l) => l.product_id === id)
  const hasWarning = lines.some((l) => overHome(l) !== null)

  return (
    <section>
      <h2>Chuyển hàng ra quầy</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <label>
          Ngày chuyển
          <input
            type="date"
            max={todayVN()}
            {...register('transfer_date', { required: 'Chọn ngày chuyển', validate: notFuture })}
          />
        </label>
        {errors.transfer_date && <p className="error">{errors.transfer_date.message}</p>}

        {stocked.length === 0 ? (
          <p className="muted">Cửa hàng chưa có món nào đếm tồn kho.</p>
        ) : (
          <ProductPicker
            products={stocked}
            selectedIds={lines.map((l) => l.product_id)}
            onChange={onPick}
            renderInfo={info}
            quick={quick}
            onQuickChange={setQuickMode}
            renderQuick={(p) => {
              const line = lineFor(p.id)
              const warn = line && overHome(line)
              return (
                <div className="quick-inputs">
                  <QtyStepper
                    value={line?.qty ?? ''}
                    onChange={(v) => setQty(p.id, v)}
                    min={0}
                    label={`số lượng chuyển ${p.name}`}
                  />
                  {warn && <small className="warn">{warn}</small>}
                </div>
              )
            }}
          />
        )}

        {!quick && lines.length > 0 && (
          <div className="picked">
            <h3>Món đã chọn ({lines.length})</h3>
            {lines.map((line) => {
              const name = byId.get(line.product_id)?.name ?? ''
              const warn = overHome(line)
              return (
                <div key={line.product_id} className="picked-row">
                  <div className="picker-name">
                    {name}
                    {warn && <small className="warn">{warn}</small>}
                  </div>
                  <QtyStepper
                    value={line.qty}
                    onChange={(v) => setQty(line.product_id, v)}
                    min={1}
                    label={`số lượng chuyển ${name}`}
                  />
                  <button type="button" className="link" onClick={() => removeLine(line.product_id)}>
                    Xoá
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        <p className="total">{lines.length} món sẽ chuyển ra quầy</p>

        {formError && <p className="error">{formError}</p>}
        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting || hasWarning}>
          {isSubmitting ? 'Đang lưu…' : 'Chuyển hàng'}
        </button>
      </form>
    </section>
  )
}
