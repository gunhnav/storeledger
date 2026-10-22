import { useEffect, useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { MAX_MONEY, MAX_QTY, capitalizeFirst, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import { evalExpression, isExpression } from '../lib/calc'
import { expenseLine, isBlankDraft, parseDraft, storedUnitPrice, type ExpenseDraft } from '../lib/expenses'
import type { Expense } from '../types/database'

// Món đếm tồn chỉ ghi vào Chi phí theo hai nhóm này (DB chỉ nhận hai nhóm)
const STOCK_CATEGORIES = ['Đồ uống', 'Nguyên liệu']

type Row = ExpenseDraft & { id: number }

const cleanNumber = (text: string) => text.replace(/[^0-9.]/g, '')
const cleanExpression = (text: string) => text.replace(/[^0-9.,+\-*/x×÷:()kKtTrR\s]/g, '')
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : (evalExpression(text) ?? Number.NaN))
const normalize = (v: string) => v.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/\s+/g, ' ')
let nextId = 1

// Nhập hàng của Bún đậu: y như trang Chi phí (nhóm, tên hạng mục gõ tự do, số lượng, đơn giá, thành tiền).
//  - Tên trùng một món đếm tồn (7Up, Coca...): vào tồn kho (tự ra quán), tiền nhập tự ghi vào Chi phí
//    nhưng không tính lại vào lãi lỗ (giá vốn đã tính khi bán).
//  - Tên khác (rau, xoài...): ghi thẳng thành khoản chi phí như trang Chi phí.
// Nhân viên chỉ nhập món đếm tồn + số lượng, không thấy giá (DB dùng giá vốn hiện hành) và không ghi chi phí khác.
export function PurchaseRowsForm({ storeId, autoToShop, groups }: { storeId: string; autoToShop: boolean; groups: readonly string[] }) {
  const { t } = useI18n()
  const toast = useToast()
  const { isAdmin } = useAuth()
  const { products, reload, loading, error } = useStoreCatalog(storeId)
  const newRow = (category: string = groups[0]): Row => ({ id: nextId++, category, note: '', quantity: '1', unitPrice: '', total: '' })
  const [date, setDate] = useState(todayVN())
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // 20 khoản chi gần nhất của cửa hàng (chỉ admin đọc được), tải lại sau mỗi lần lưu
  const [recent, setRecent] = useState<{ rows: Expense[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  // Bộ lọc danh sách: khoảng ngày (để trống = không giới hạn) và nhóm
  const [filter, setFilter] = useState({ from: '', to: '', category: '' })
  const filtered = filter.from !== '' || filter.to !== '' || filter.category !== ''
  const badRange = filter.from !== '' && filter.to !== '' && filter.from > filter.to

  useEffect(() => {
    if (!isAdmin || badRange) return
    let cancelled = false
    let query = supabase.from('expenses').select('*').eq('store_id', storeId)
    if (filter.from) query = query.gte('expense_date', filter.from)
    if (filter.to) query = query.lte('expense_date', filter.to)
    if (filter.category) query = query.eq('category', filter.category)
    query
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(filtered ? 500 : 20)
      .then(({ data, error }) => {
        if (!cancelled) setRecent({ rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, storeId, version, filter.from, filter.to, filter.category, filtered, badRange])

  const stocked = products.filter((p) => p.tracks_stock)
  const stockByName = new Map(stocked.map((p) => [normalize(p.name), p]))
  const stockOf = (r: Row) => stockByName.get(normalize(r.note))

  const update = (id: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)))
  // Dòng mới lấy nhóm của dòng cuối để nhập liền nhiều món cùng nhóm
  const addRow = () => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.category)])
  const removeRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs))

  const filled = rows.filter((r) => !isBlankDraft(r))
  // Nhân viên không có ô giá nên chỉ cần tên + số lượng
  const parsed = filled.map((r) => ({ row: r, result: !isAdmin || (stockOf(r) && r.unitPrice.trim() === '' && r.total.trim() === '') ? null : parseDraft(r, MAX_MONEY) }))
  const total = parsed.reduce((s, p) => s + (p.result?.ok ? p.result.total : 0), 0)
  const hasBlankStockPrice = isAdmin && filled.some((r) => stockOf(r) && r.unitPrice.trim() === '' && r.total.trim() === '')

  const save = async () => {
    setResult(null)
    const dateError = notFuture(date)
    if (dateError !== true) return setResult({ ok: false, text: dateError })
    if (filled.length === 0) return setResult({ ok: false, text: 'Nhập ít nhất một khoản' })

    const stockItems: { row: Row; product_id: string; quantity: number; unit_cost: number | null }[] = []
    const expenseRows: { row: Row; parsed: Extract<NonNullable<(typeof parsed)[number]['result']>, { ok: true }> }[] = []
    for (const p of parsed) {
      const n = rows.indexOf(p.row) + 1
      const fail = (text: string) => setResult({ ok: false, text: t('Dòng {n}: {error}', { n, error: t(text) }) })
      const r = p.row
      if (r.note.trim() === '') return fail('Nhập tên hạng mục')
      const product = stockOf(r)
      if (product) {
        const quantity = Number(r.quantity)
        if (!Number.isInteger(quantity) || quantity <= 0) return fail('Số lượng phải là số nguyên > 0')
        if (quantity > MAX_QTY) return fail('Số lượng quá lớn, kiểm tra lại')
        if (!STOCK_CATEGORIES.includes(r.category)) return fail('Món đếm tồn chỉ thuộc nhóm Đồ uống hoặc Nguyên liệu')
        let unitCost: number | null = null
        if (p.result) {
          if (!p.result.ok) return fail(p.result.error)
          unitCost = storedUnitPrice(p.result.total / quantity)
        }
        stockItems.push({ row: r, product_id: product.id, quantity, unit_cost: unitCost })
      } else {
        if (!isAdmin) return fail('Món này chưa có trong danh mục tồn kho, nhờ admin ghi vào Chi phí')
        if (!p.result || !p.result.ok) return fail(p.result && !p.result.ok ? p.result.error : 'Nhập đơn giá hoặc thành tiền')
        expenseRows.push({ row: r, parsed: p.result })
      }
    }

    // Món đếm tồn lặp ở nhiều dòng phải cùng nhóm (DB gắn nhóm theo món)
    const categoryOf = new Map<string, string>()
    for (const it of stockItems) {
      const prev = categoryOf.get(it.product_id)
      if (prev !== undefined && prev !== it.row.category) {
        return setResult({ ok: false, text: t('"{name}" ở nhiều dòng phải cùng một nhóm chi phí', { name: it.row.note.trim() }) })
      }
      categoryOf.set(it.product_id, it.row.category)
    }

    setSaving(true)
    const finish = (text: string) => {
      setSaving(false)
      setResult({ ok: false, text })
      reload()
      setVersion((v) => v + 1)
    }

    if (stockItems.length > 0) {
      const { data: purchaseId, error: purchaseError } = await supabase.rpc('create_purchase', {
        p_store_id: storeId,
        p_purchase_date: date,
        p_note: null,
        p_items: stockItems.map(({ product_id, quantity, unit_cost }) => ({ product_id, quantity, unit_cost })),
      })
      if (purchaseError || !purchaseId) return finish(purchaseError ? errorMessage(purchaseError) : 'Không tạo được đợt nhập')

      // Phần tồn kho đã lưu: bỏ các dòng đó khỏi form để bấm lưu lại không nhập trùng
      const savedIds = new Set(stockItems.map((i) => i.row.id))
      setRows((rs) => {
        const left = rs.filter((r) => !savedIds.has(r.id))
        return left.length > 0 ? left : [newRow()]
      })

      const { error: expenseError } = await supabase.rpc('record_purchase_expenses', {
        p_purchase_id: purchaseId,
        p_category: STOCK_CATEGORIES[0],
        p_categories: Object.fromEntries(categoryOf),
      })
      if (expenseError) return finish(t('Đã nhập hàng nhưng chưa ghi được vào Chi phí: {error}', { error: t(errorMessage(expenseError)) }))

      // Quán không có bước Phân phối: chuyển ngay hàng vừa nhập ra quán (cùng ngày nhập)
      if (autoToShop) {
        const failed: string[] = []
        for (const item of stockItems) {
          const { error: moveError } = await supabase.rpc('create_transfer', {
            p_store_id: storeId,
            p_product_id: item.product_id,
            p_quantity: item.quantity,
            p_transfer_date: date,
            p_note: 'Tự vào quán khi nhập hàng',
            p_destination: 'shop',
          })
          if (moveError) failed.push(`${item.row.note.trim()}: ${t(errorMessage(moveError))}`)
        }
        if (failed.length > 0) return finish(t('Đã nhập hàng nhưng chưa đưa vào quán được: {list}', { list: failed.join('; ') }))
      }
    }

    // Các khoản không phải món đếm tồn: ghi thẳng vào Chi phí (như trang Chi phí)
    if (expenseRows.length > 0) {
      const { error: insertError } = await supabase.from('expenses').insert(
        expenseRows.map(({ row, parsed: r }) => ({
          store_id: storeId,
          expense_date: date,
          category: row.category,
          note: capitalizeFirst(row.note.trim()) || null,
          quantity: r.quantity,
          unit_price: r.unitPrice,
          amount: r.total,
        })),
      )
      if (insertError) return finish(errorMessage(insertError))
      const savedIds = new Set(expenseRows.map((e) => e.row.id))
      setRows((rs) => {
        const left = rs.filter((r) => !savedIds.has(r.id))
        return left.length > 0 ? left : [newRow()]
      })
    }

    setSaving(false)
    toast.success(t('Đã lưu {count} khoản ngày {date}', { count: filled.length, date: formatDate(date) }))
    reload()
    setVersion((v) => v + 1)
  }

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  const gridClass = isAdmin ? 'expense-line' : 'expense-line purchase-line no-price'

  return (
    <section>
      <div className="card form">
        <div className="field expense-date">
          {t('Ngày nhập')}
          <DatePicker value={date} onChange={setDate} max={todayVN()} label={t('Ngày nhập')} />
        </div>

        <datalist id="purchase-stock-names">
          {stocked.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>

        <div className="expense-lines">
          <div className={`${gridClass} expense-line-head`} aria-hidden="true">
            {isAdmin && <span>{t('Nhóm chi phí')}</span>}
            <span>{t('Hạng mục / ghi chú')}</span>
            <span>{t('Số lượng')}</span>
            {isAdmin && <span>{t('Đơn giá')}</span>}
            {isAdmin && <span>{t('Thành tiền')}</span>}
            <span />
          </div>
          {rows.map((r, i) => {
              const p = parsed.find((x) => x.row.id === r.id)
              const error = p?.result && !p.result.ok ? p.result.error : null
              const line = expenseLine(toNumber(r.quantity), toNumber(r.unitPrice) || 0, r.total.trim() === '' ? null : toNumber(r.total))
              const isStock = r.note.trim() !== '' && !!stockOf(r)
              return (
                <div key={r.id} className={`${gridClass}${error ? ' has-error' : ''}`}>
                  {isAdmin && (
                    <label>
                      <span className="mobile-label">{t('Nhóm chi phí')}</span>
                      <select value={r.category} onChange={(e) => update(r.id, { category: e.target.value })} aria-label={t('Nhóm chi phí')}>
                        {groups.map((g) => (
                          <option key={g} value={g}>
                            {t(g)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span className="mobile-label">{t('Hạng mục / ghi chú')}</span>
                    <input
                      type="text"
                      list="purchase-stock-names"
                      autoCapitalize="sentences"
                      aria-label={t('Hạng mục / ghi chú')}
                      placeholder={i === 0 ? t('Tên món hoặc hạng mục') : undefined}
                      value={r.note}
                      onChange={(e) => {
                        // Không đổi chữ khi bộ gõ tiếng Việt đang ghép dấu, viết hoa chữ đầu khi gõ xong
                        const composing = (e.nativeEvent as InputEvent).isComposing
                        update(r.id, { note: composing ? e.target.value : capitalizeFirst(e.target.value) })
                      }}
                      onCompositionEnd={(e) => update(r.id, { note: capitalizeFirst(e.currentTarget.value) })}
                    />
                    {isStock && <small className="calc-result">{t('Vào tồn kho')}</small>}
                  </label>
                  <label>
                    <span className="mobile-label">{t('Số lượng')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={t('Số lượng')}
                      value={r.quantity}
                      onChange={(e) => update(r.id, { quantity: cleanNumber(e.target.value) })}
                      onKeyDown={isAdmin ? undefined : (e) => {
                        if (e.key === 'Enter' && i === rows.length - 1) {
                          e.preventDefault()
                          addRow()
                        }
                      }}
                    />
                  </label>
                  {isAdmin && (
                    <label>
                      <span className="mobile-label">{t('Đơn giá')}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={t('Đơn giá')}
                        className={line.overridden ? 'computed' : undefined}
                        readOnly={line.overridden}
                        placeholder={isStock ? t('Giá vốn hiện hành') : undefined}
                        value={line.overridden ? (Number.isFinite(line.unitPrice) ? formatVND(line.unitPrice) : '') : r.unitPrice}
                        onChange={(e) => update(r.id, { unitPrice: cleanExpression(e.target.value) })}
                      />
                    </label>
                  )}
                  {isAdmin && (
                    <label>
                      <span className="mobile-label">{t('Thành tiền')}</span>
                      <span className="input-action">
                        {/* Bàn phím đầy đủ để gõ được phép tính, ví dụ 50000+30000*2 hoặc 3x25k */}
                        <input
                          type="text"
                          aria-label={t('Thành tiền')}
                          className={line.overridden ? 'overridden' : undefined}
                          placeholder={Number.isFinite(line.total) && line.total > 0 ? formatVND(line.total) : t('Số hoặc phép tính')}
                          value={r.total}
                          onChange={(e) => update(r.id, { total: cleanExpression(e.target.value) })}
                          onKeyDown={(e) => {
                            // Enter ở ô cuối của dòng cuối: thêm dòng mới
                            if (e.key === 'Enter' && i === rows.length - 1) {
                              e.preventDefault()
                              addRow()
                            }
                          }}
                        />
                        {isExpression(r.total) && Number.isFinite(line.total) && <small className="calc-result">= {formatVND(line.total)}</small>}
                        {line.overridden && (
                          <button type="button" className="input-action-btn" title={t('Tính lại')} aria-label={t('Tính lại')} onClick={() => update(r.id, { total: '' })}>
                            ↺
                          </button>
                        )}
                      </span>
                    </label>
                  )}
                  {rows.length > 1 ? (
                    <button type="button" className="remove" aria-label={t('Xoá dòng {n}', { n: i + 1 })} onClick={() => removeRow(r.id)}>
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

        <button type="button" className="expense-add" onClick={addRow}>
          + {t('Thêm dòng')}
        </button>
        <small className="muted">
          {isAdmin
            ? t('Tên trùng món đếm tồn (7Up, Coca…) thì vào tồn kho và tiền nhập tự ghi vào Chi phí; tên khác ghi thẳng thành khoản chi. Thành tiền tự tính = số lượng × đơn giá, gõ số hoặc phép tính để ghi đè.')
            : t('Gõ tên món đếm tồn và số lượng, giá nhập do hệ thống tự lấy.')}
        </small>

        <div className="expense-footer">
          <span>
            {t('{count} khoản', { count: filled.length })}
            {isAdmin && (
              <>
                {' · '}
                <strong>{formatVND(total)}</strong>
                {hasBlankStockPrice && <small className="muted"> {t('(chưa gồm món để trống giá)')}</small>}
              </>
            )}
          </span>
          <button type="button" className="primary" disabled={saving || filled.length === 0} onClick={save}>
            {saving ? t('Đang lưu…') : t('Lưu {count} khoản', { count: filled.length })}
          </button>
        </div>
        {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
      </div>

      {isAdmin && (
        <>
          <h2 className="section-title">{filtered ? t('Khoản chi') : t('20 khoản chi gần nhất')}</h2>
          <div className="filters">
            <div className="field">
              {t('Từ ngày')}
              <DatePicker value={filter.from} onChange={(v) => setFilter((f) => ({ ...f, from: v }))} label={t('Từ ngày')} />
            </div>
            <div className="field">
              {t('Đến ngày')}
              <DatePicker value={filter.to} onChange={(v) => setFilter((f) => ({ ...f, to: v }))} label={t('Đến ngày')} />
            </div>
            <label>
              {t('Nhóm')}
              <select value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
                <option value="">{t('Tất cả')}</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {t(g)}
                  </option>
                ))}
              </select>
            </label>
            {filtered && (
              <button type="button" onClick={() => setFilter({ from: '', to: '', category: '' })}>
                {t('Xoá lọc')}
              </button>
            )}
          </div>
          {badRange ? (
            <p className="error">{t('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".')}</p>
          ) : !recent ? (
            <p className="muted">{t('Đang tải…')}</p>
          ) : recent.error ? (
            <p className="error">{t(recent.error)}</p>
          ) : recent.rows.length === 0 ? (
            <p className="muted">{filtered ? t('Không có khoản chi nào khớp bộ lọc.') : t('Chưa có chi phí nào.')}</p>
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
                  </tr>
                </thead>
                <tbody>
                  {recent.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.expense_date)}</td>
                      <td>{t(r.category)}</td>
                      <td>
                        {(r.note ?? '').replace(/^Nhập kho: /, '')}
                        {r.purchase_id && <small className="muted"> · {t('Nhập kho')}</small>}
                      </td>
                      <td className="num">{r.quantity}</td>
                      <td className="num">{formatVND(r.unit_price)}</td>
                      <td className="num">
                        <strong>{formatVND(r.amount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filtered && recent && !recent.error && recent.rows.length > 0 && (
            <p className="expense-footer">
              <span>{t('{count} khoản', { count: recent.rows.length })}</span>
              <strong>{formatVND(recent.rows.reduce((s, r) => s + r.amount, 0))}</strong>
            </p>
          )}
        </>
      )}
    </section>
  )
}
