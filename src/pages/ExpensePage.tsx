import { useEffect, useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { MAX_MONEY, capitalizeFirst, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import { expenseGroupsFor, expenseLine, isBlankDraft, parseDraft, type ExpenseDraft } from '../lib/expenses'
import type { Expense } from '../types/database'

type Draft = ExpenseDraft & { id: number }

const cleanNumber = (text: string) => text.replace(/[^0-9.]/g, '')
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))
let nextId = 1

export function ExpensePage() {
  const { current } = useStore()
  return current ? <ExpenseForm key={current.id} storeId={current.id} groups={expenseGroupsFor(current.code)} /> : null
}

// Chỉ admin (route bọc RequireAdmin, RLS cũng chặn).
// Thêm mới: một ngày, nhiều dòng chi phí, lưu một lần. Sửa: form chỉ có một dòng của khoản đang sửa.
function ExpenseForm({ storeId, groups }: { storeId: string; groups: readonly string[] }) {
  const { t } = useI18n()
  const toast = useToast()
  const newDraft = (category = groups[0]): Draft => ({ id: nextId++, category, note: '', quantity: '1', unitPrice: '', total: '' })
  const [recent, setRecent] = useState<{ rows: Expense[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [date, setDate] = useState(todayVN())
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft()])
  const [saving, setSaving] = useState(false)
  // Đang sửa khoản chi nào (null = thêm mới)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const update = (id: number, change: Partial<ExpenseDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...change } : d)))
  // Dòng mới lấy nhóm của dòng cuối để nhập liền nhiều món cùng nhóm
  const addDraft = () => setDrafts((ds) => [...ds, newDraft(ds[ds.length - 1]?.category)])
  const removeDraft = (id: number) => setDrafts((ds) => (ds.length > 1 ? ds.filter((d) => d.id !== id) : ds))

  const filled = drafts.filter((d) => !isBlankDraft(d))
  const parsed = filled.map((d) => ({ draft: d, result: parseDraft(d, MAX_MONEY) }))
  const total = parsed.reduce((s, p) => s + (p.result.ok ? p.result.total : 0), 0)

  const resetForm = () => {
    setEditing(null)
    setDrafts([newDraft()])
  }

  const save = async () => {
    setResult(null)
    const dateError = notFuture(date)
    if (dateError !== true) return setResult({ ok: false, text: dateError })
    if (filled.length === 0) return setResult({ ok: false, text: 'Nhập ít nhất một khoản chi' })
    const bad = parsed.findIndex((p) => !p.result.ok)
    if (bad >= 0) {
      const r = parsed[bad].result
      return setResult({ ok: false, text: t('Dòng {n}: {error}', { n: drafts.indexOf(parsed[bad].draft) + 1, error: r.ok ? '' : t(r.error) }) })
    }
    const rows = parsed.map(({ draft, result }) => {
      const r = result as Extract<typeof result, { ok: true }>
      return {
        category: draft.category,
        note: capitalizeFirst(draft.note.trim()) || null,
        quantity: r.quantity,
        unit_price: r.unitPrice,
        amount: r.total,
      }
    })
    setSaving(true)
    // Sửa qua hàm update_expense (SECURITY DEFINER, chỉ admin); thêm mới: một lệnh insert nhiều dòng (cùng thành công / thất bại)
    const { error } = editing
      ? await supabase.rpc('update_expense', {
          p_expense_id: editing.id,
          p_expense_date: date,
          p_category: rows[0].category,
          p_note: rows[0].note,
          p_quantity: rows[0].quantity,
          p_unit_price: rows[0].unit_price,
          p_amount: rows[0].amount,
        })
      : await supabase.from('expenses').insert(rows.map((r) => ({ ...r, store_id: storeId, expense_date: date })))
    setSaving(false)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(
      editing
        ? t('Đã sửa chi phí {amount} ngày {date}', { amount: formatVND(total), date: formatDate(date) })
        : t('Đã lưu {count} khoản chi {amount} ngày {date}', { count: rows.length, amount: formatVND(total), date: formatDate(date) }),
    )
    if (editing) setDate(todayVN())
    resetForm()
    setVersion((v) => v + 1)
  }

  // Đưa khoản chi lên form để sửa; thành tiền khác số lượng × đơn giá nghĩa là đã ghi đè
  const startEdit = (row: Expense) => {
    setResult(null)
    setEditing(row)
    setDate(row.expense_date)
    const overridden = Math.abs(row.quantity * row.unit_price - row.amount) > 0.005
    setDrafts([
      {
        id: nextId++,
        category: row.category,
        note: row.note ?? '',
        quantity: String(row.quantity),
        unitPrice: String(row.unit_price),
        total: overridden ? String(row.amount) : '',
      },
    ])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setResult(null)
    setDate(todayVN())
    resetForm()
  }

  const remove = async (row: Expense) => {
    const label = `${row.note || t(row.category)} – ${formatVND(row.amount)} (${formatDate(row.expense_date)})`
    if (!window.confirm(t('Xoá khoản chi {label}? Không hoàn tác được.', { label }))) return
    setBusyId(row.id)
    const { error } = await supabase.rpc('delete_expense', { p_expense_id: row.id })
    setBusyId(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    if (editing?.id === row.id) cancelEdit()
    toast.success(t('Đã xoá khoản chi {label}', { label }))
    setVersion((v) => v + 1)
  }

  return (
    <section>
      <div className={editing ? 'card form editing' : 'card form'}>
        {editing && (
          <p className="edit-banner">
            {t('Đang sửa khoản chi ngày {date}', { date: formatDate(editing.expense_date) })}
            <button type="button" className="link" onClick={cancelEdit}>
              {t('Huỷ sửa')}
            </button>
          </p>
        )}
        <div className="field expense-date">
          {t('Ngày')}
          <DatePicker value={date} onChange={setDate} max={todayVN()} label={t('Ngày')} />
        </div>

        <div className="expense-lines">
          <div className="expense-line expense-line-head" aria-hidden="true">
            <span>{t('Nhóm chi phí')}</span>
            <span>{t('Hạng mục / ghi chú')}</span>
            <span>{t('Số lượng')}</span>
            <span>{t('Đơn giá')}</span>
            <span>{t('Thành tiền')}</span>
            <span />
          </div>
          {drafts.map((d, i) => {
            const line = expenseLine(toNumber(d.quantity), toNumber(d.unitPrice) || 0, d.total.trim() === '' ? null : toNumber(d.total))
            const p = parsed.find((x) => x.draft.id === d.id)
            const error = p && !p.result.ok ? p.result.error : null
            return (
              <div key={d.id} className={`expense-line${error ? ' has-error' : ''}`}>
                <label>
                  <span className="mobile-label">{t('Nhóm chi phí')}</span>
                  <select value={d.category} onChange={(e) => update(d.id, { category: e.target.value })} aria-label={t('Nhóm chi phí')}>
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {t(g)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mobile-label">{t('Hạng mục / ghi chú')}</span>
                  <input
                    type="text"
                    autoCapitalize="sentences"
                    aria-label={t('Hạng mục / ghi chú')}
                    placeholder={i === 0 ? t('Ví dụ: thìa, banner, thùng giữ lạnh') : undefined}
                    value={d.note}
                    onChange={(e) => {
                      // Không đổi chữ khi bộ gõ tiếng Việt đang ghép dấu, viết hoa khi gõ xong
                      const composing = (e.nativeEvent as InputEvent).isComposing
                      update(d.id, { note: composing ? e.target.value : capitalizeFirst(e.target.value) })
                    }}
                    onCompositionEnd={(e) => update(d.id, { note: capitalizeFirst(e.currentTarget.value) })}
                  />
                </label>
                <label>
                  <span className="mobile-label">{t('Số lượng')}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={t('Số lượng')}
                    value={d.quantity}
                    onChange={(e) => update(d.id, { quantity: cleanNumber(e.target.value) })}
                  />
                </label>
                <label>
                  <span className="mobile-label">{t('Đơn giá')}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={t('Đơn giá')}
                    className={line.overridden ? 'computed' : undefined}
                    readOnly={line.overridden}
                    value={line.overridden ? (Number.isFinite(line.unitPrice) ? formatVND(line.unitPrice) : '') : d.unitPrice}
                    onChange={(e) => update(d.id, { unitPrice: cleanNumber(e.target.value) })}
                  />
                </label>
                <label>
                  <span className="mobile-label">{t('Thành tiền')}</span>
                  <span className="input-action">
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={t('Thành tiền')}
                      className={line.overridden ? 'overridden' : undefined}
                      placeholder={Number.isFinite(line.total) && line.total > 0 ? formatVND(line.total) : t('= số lượng × đơn giá')}
                      value={d.total}
                      onChange={(e) => update(d.id, { total: cleanNumber(e.target.value) })}
                      onKeyDown={(e) => {
                        // Enter ở ô cuối của dòng cuối: thêm dòng mới
                        if (e.key === 'Enter' && !editing && i === drafts.length - 1) {
                          e.preventDefault()
                          addDraft()
                        }
                      }}
                    />
                    {line.overridden && (
                      <button
                        type="button"
                        className="input-action-btn"
                        title={t('Tính lại')}
                        aria-label={t('Tính lại')}
                        onClick={() => update(d.id, { total: '' })}
                      >
                        ↺
                      </button>
                    )}
                  </span>
                </label>
                {!editing && drafts.length > 1 ? (
                  <button type="button" className="remove" aria-label={t('Xoá dòng {n}', { n: i + 1 })} onClick={() => removeDraft(d.id)}>
                    ×
                  </button>
                ) : (
                  <span />
                )}
                {error && <small className="error expense-line-error">{t(error)}</small>}
              </div>
            )
          })}
        </div>

        {!editing && (
          <button type="button" className="expense-add" onClick={addDraft}>
            + {t('Thêm dòng')}
          </button>
        )}
        <small className="muted">{t('Thành tiền tự tính = số lượng × đơn giá. Gõ vào ô Thành tiền để ghi đè.')}</small>

        <div className="expense-footer">
          <span>
            {t('{count} khoản', { count: filled.length })} · <strong>{formatVND(total)}</strong>
          </span>
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? t('Đang lưu…') : editing ? t('Lưu thay đổi') : t('Lưu {count} khoản chi', { count: filled.length })}
          </button>
        </div>
        {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
      </div>

      <h2 className="section-title">{t('20 chi phí gần nhất')}</h2>
      {!recent ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : recent.error ? (
        <p className="error">{t(recent.error)}</p>
      ) : recent.rows.length === 0 ? (
        <p className="muted">{t('Chưa có chi phí nào.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Ngày')}</th>
                <th>{t('Nhóm')}</th>
                <th>{t('Hạng mục / ghi chú')}</th>
                <th className="num">{t('Số lượng')}</th>
                <th className="num">{t('Đơn giá')}</th>
                <th className="num">{t('Thành tiền')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id} className={editing?.id === r.id ? 'row-editing' : undefined}>
                  <td>{formatDate(r.expense_date)}</td>
                  <td>{t(r.category)}</td>
                  <td>{r.note}</td>
                  <td className="num">{r.quantity}</td>
                  <td className="num">{formatVND(r.unit_price)}</td>
                  <td className="num">
                    <strong>{formatVND(r.amount)}</strong>
                  </td>
                  <td className="actions">
                    <button type="button" className="link" disabled={busyId === r.id} onClick={() => startEdit(r)}>
                      {t('Sửa')}
                    </button>
                    <button type="button" className="link danger" disabled={busyId === r.id} onClick={() => remove(r)}>
                      {t('Xoá')}
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
