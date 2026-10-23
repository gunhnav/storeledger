import { useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { errorMessage, formatDate, todayVN } from '../lib/format'
import {
  SET_SIZES,
  describeSets,
  groupIssue,
  mixTotal,
  overHomeSets,
  setTotals,
  type SetGroup,
  type SetGroupIssue,
} from '../lib/companySets'

const ISSUES: Record<SetGroupIssue, string> = {
  count: 'Số set phải là số nguyên > 0',
  mix_short: 'Chưa đủ vị cho 1 set',
  mix_over: 'Vượt cỡ set',
  mix_invalid: 'Số hũ mỗi vị phải là số nguyên',
}

let nextId = 1
const newGroup = (): SetGroup => ({ id: `g${nextId++}`, size: 4, count: 1, mix: {} })

// Phân phối từ nhà cho Công ty theo set 4 / set 6, mỗi set mix nhiều vị.
// Mỗi vị lưu một lần create_transfer (nơi nhận 'company'), ghi chú mô tả các set.
export function CompanyDistribution({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [date, setDate] = useState(todayVN())
  const [note, setNote] = useState('')
  const [groups, setGroups] = useState<SetGroup[]>(() => [newGroup()])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  const stocked = products.filter((p) => p.tracks_stock)
  const names = new Map(stocked.map((p) => [p.id, p.name]))
  const home = new Map(stocked.map((p) => [p.id, stock.get(p.id)?.qty_home ?? 0]))
  const totals = setTotals(groups)
  const over = overHomeSets(totals, home)
  const issues = groups.map(groupIssue)
  const totalJars = [...totals.values()].reduce((s, n) => s + n, 0)
  const totalSets = groups.reduce((s, g, i) => s + (issues[i] ? 0 : g.count), 0)
  const canSave = !saving && totals.size > 0 && issues.every((i) => i === null) && over.length === 0

  const update = (id: string, change: Partial<SetGroup>) =>
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...change } : g)))
  const setMix = (g: SetGroup, productId: string, value: string) =>
    update(g.id, { mix: { ...g.mix, [productId]: Number(value) || 0 } })

  const save = async () => {
    setSaving(true)
    setResult(null)
    const description = describeSets(groups, names)
    const fullNote = [description, note.trim()].filter(Boolean).join(' · ')
    // Một lần gọi: DB phân phối mọi vị và lưu các set trong cùng giao dịch (lỗi thì không ghi gì)
    const { error } = await supabase.rpc('create_company_distribution', {
      p_store_id: storeId,
      p_date: date,
      p_note: fullNote,
      p_groups: groups.map((g) => ({ size: g.size, count: g.count, mix: g.mix })),
    })
    setSaving(false)
    if (error) {
      setResult(t(errorMessage(error)))
      return
    }
    reload()
    const list = [...totals].map(([productId, quantity]) => `${quantity} ${names.get(productId) ?? ''}`).join(', ')
    toast.success(t('Đã phân phối cho công ty ngày {date}: {list}', { date: formatDate(date), list }))
    setGroups([newGroup()])
    setNote('')
  }

  if (stocked.length === 0) return <p className="pos-empty muted">{t('Cửa hàng chưa có món nào đếm tồn kho.')}</p>

  return (
    <section className="company-dist">
      <div className="row">
        <div className="field">
          {t('Ngày phân phối')}
          <DatePicker value={date} onChange={setDate} max={todayVN()} label={t('Ngày phân phối')} />
        </div>
        <label className="field">
          {t('Ghi chú')}
          <input type="text" placeholder={t('Ví dụ: tên công ty')} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="set-groups">
        {groups.map((g, i) => {
          const filled = mixTotal(g)
          const issue = issues[i]
          return (
            <article key={g.id} className={`card set-group${issue ? ' has-issue' : ' ok'}`}>
              <header className="set-group-head">
                <div className="segmented" role="radiogroup" aria-label={t('Cỡ set')}>
                  {SET_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={g.size === size}
                      className={g.size === size ? 'active' : undefined}
                      onClick={() => update(g.id, { size })}
                    >
                      {t('Set {size}', { size })}
                    </button>
                  ))}
                </div>
                <label className="set-count">
                  {t('Số set')}
                  <QtyStepper
                    value={String(g.count || '')}
                    onChange={(v) => update(g.id, { count: Number(v) || 0 })}
                    min={1}
                    label={t('Số set')}
                  />
                </label>
                {groups.length > 1 && (
                  <button
                    type="button"
                    className="remove"
                    aria-label={t('Xoá nhóm set')}
                    onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                  >
                    ×
                  </button>
                )}
              </header>

              <p className={`set-fill ${filled === g.size ? 'positive' : 'warn'}`}>
                {t('Mỗi set: {filled}/{size} hũ', { filled, size: g.size })}
                {issue && issue !== 'mix_short' && ` · ${t(ISSUES[issue])}`}
              </p>

              <ul className="set-mix">
                {stocked.map((p) => (
                  <li key={p.id} className={(g.mix[p.id] ?? 0) > 0 ? 'picked' : undefined}>
                    <span>{p.name}</span>
                    <QtyStepper
                      value={g.mix[p.id] ? String(g.mix[p.id]) : ''}
                      onChange={(v) => setMix(g, p.id, v)}
                      min={0}
                      label={t('Số hũ {name} trong 1 set', { name: p.name })}
                    />
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>

      <button type="button" onClick={() => setGroups((gs) => [...gs, newGroup()])}>
        + {t('Thêm loại set')}
      </button>

      <div className="card set-summary">
        <h3>{t('Tổng cần phân phối')}</h3>
        {totals.size === 0 ? (
          <p className="muted">{t('Chọn vị cho đủ số hũ của mỗi set.')}</p>
        ) : (
          <ul className="order-summary">
            {[...totals].map(([productId, qty]) => {
              const warn = over.find((o) => o.productId === productId)
              return (
                <li key={productId} className={warn ? 'has-warn' : undefined}>
                  <span className="summary-name">{names.get(productId)}</span>
                  <span className="summary-qty">{t('Ở nhà còn {count}', { count: home.get(productId) ?? 0 })}</span>
                  <strong>{qty}</strong>
                </li>
              )
            })}
          </ul>
        )}
        <div className="pos-total">
          <span>{t('{sets} set · {jars} hũ', { sets: totalSets, jars: totalJars })}</span>
        </div>
        {over.length > 0 && (
          <p className="error">
            {t('Vượt số ở nhà: {list}', {
              list: over.map((o) => `${names.get(o.productId)} (${o.want}/${o.home})`).join(', '),
            })}
          </p>
        )}
        {/* Đã lấy hũ từ quán lên công ty: chuyển lại từ quán về nhà (Phân phối → Về nhà) rồi phân phối cho công ty */}
        {over.some((o) => (stock.get(o.productId)?.qty_shop ?? 0) >= o.want - o.home) && (
          <p className="muted">
            {t('Quán còn hàng: {list}. Vào Phân phối → Về nhà để chuyển lại, rồi phân phối cho công ty.', {
              list: over
                .filter((o) => (stock.get(o.productId)?.qty_shop ?? 0) >= o.want - o.home)
                .map((o) => `${names.get(o.productId)} (${stock.get(o.productId)?.qty_shop ?? 0})`)
                .join(', '),
            })}
          </p>
        )}
        {result && <p className="error">{result}</p>}
        <button type="button" className="primary block" disabled={!canSave} onClick={save}>
          {saving ? t('Đang lưu…') : t('Phân phối cho công ty')}
        </button>
      </div>
    </section>
  )
}
