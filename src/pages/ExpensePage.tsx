import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { errorMessage, formatVND, todayVN } from '../lib/format'
import type { Expense } from '../types/database'

type FormValues = { expense_date: string; category: string; amount: number; note: string }

// Gợi ý sẵn, cộng thêm các nhóm đã dùng gần đây
const SUGGESTED_CATEGORIES = ['Mặt bằng', 'Điện nước', 'Lương', 'Đồ dùng', 'Bao bì', 'Vận chuyển']

export function ExpensePage() {
  const { current } = useStore()
  return current ? <ExpenseForm key={current.id} storeId={current.id} /> : null
}

// Chỉ admin (route bọc RequireAdmin, RLS cũng chặn)
function ExpenseForm({ storeId }: { storeId: string }) {
  const [recent, setRecent] = useState<{ rows: Expense[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { expense_date: todayVN(), category: '', amount: Number.NaN, note: '' },
  })

  useEffect(() => {
    let cancelled = false
    supabase
      .from('expenses')
      .select('*')
      .eq('store_id', storeId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!cancelled) setRecent({ rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  const categories = [...new Set([...SUGGESTED_CATEGORIES, ...(recent?.rows ?? []).map((r) => r.category)])]

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    const { error } = await supabase.from('expenses').insert({
      store_id: storeId,
      expense_date: values.expense_date,
      category: values.category.trim(),
      amount: values.amount,
      note: values.note.trim() || null,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    setResult({ ok: true, text: `Đã lưu chi phí ${formatVND(values.amount)}` })
    reset({ expense_date: values.expense_date, category: '', amount: Number.NaN, note: '' })
    setVersion((v) => v + 1)
  }

  return (
    <section>
      <h2>Chi phí</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <div className="row">
          <label>
            Ngày
            <input type="date" {...register('expense_date', { required: true })} />
          </label>
          <label>
            Số tiền
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('amount', {
                valueAsNumber: true,
                validate: (v) => (Number.isFinite(v) && v >= 0) || 'Nhập số tiền hợp lệ',
              })}
            />
          </label>
        </div>
        {errors.amount && <p className="error">{errors.amount.message}</p>}

        <label>
          Nhóm chi phí
          <input
            type="text"
            list="expense-categories"
            {...register('category', {
              validate: (v) => v.trim() !== '' || 'Nhập nhóm chi phí',
            })}
          />
          <datalist id="expense-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        {errors.category && <p className="error">{errors.category.message}</p>}

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang lưu…' : 'Lưu chi phí'}
        </button>
      </form>

      <h2 className="section-title">20 chi phí gần nhất</h2>
      {!recent ? (
        <p className="muted">Đang tải…</p>
      ) : recent.error ? (
        <p className="error">{recent.error}</p>
      ) : recent.rows.length === 0 ? (
        <p className="muted">Chưa có chi phí nào.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Nhóm</th>
                <th className="num">Số tiền</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.expense_date.split('-').reverse().join('/')}</td>
                  <td>{r.category}</td>
                  <td className="num">{formatVND(r.amount)}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
