import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { usePrompt } from '../lib/confirm'
import { errorMessage } from '../lib/format'
import { BANKS } from '../lib/banks'
import { describePayload, payloadError } from '../lib/emvQr'

// Một dòng giá set: cỡ set, áp dụng cho ('' = set mix vị, còn lại là mã vị), giá (chuỗi để cho phép ô trống khi gõ)
type RuleDraft = { uid: number; size: 4 | 6; productId: string; price: string }
type Settings = { is_public: boolean; public_phone: string; public_tagline: string; bankCode: string; bankAccount: string; bankHolder: string; qrPayload: string; qrLabel: string }
type ProductOption = { id: string; name: string; category: string | null; public_sale_mode: 'set' | 'single' }

let nextUid = 1
const digits = (text: string) => text.replace(/[^\d]/g, '')

// Cài đặt trang bán hàng công khai /shop/<mã quán> (chỉ admin; RLS stores_update_admin chặn người khác)
export function StorefrontSettings({ storeId, code, onSaved }: { storeId: string; code: string; onSaved?: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const prompt = usePrompt()
  const [form, setForm] = useState<Settings | null>(null)
  const [rules, setRules] = useState<RuleDraft[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  // Cách bán từng dòng món trên trang khách: theo set hoặc lẻ (lưu cho mọi món cùng nhóm)
  const [modes, setModes] = useState<Record<string, 'set' | 'single'>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [payMethod, setPayMethod] = useState<'qr' | 'bank' | 'none'>('qr')
  const link = `${window.location.origin}/shop/${code}`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('stores').select('is_public, public_phone, public_tagline, public_bank_code, public_bank_account, public_bank_holder, public_qr_payload, public_qr_label').eq('id', storeId).single(),
      supabase.from('storefront_set_prices').select('*').eq('store_id', storeId).order('set_size').order('created_at'),
      supabase.from('products').select('id, name, category, public_sale_mode').eq('store_id', storeId).eq('is_active', true).order('name'),
    ]).then(([store, prices, prods]) => {
      if (cancelled) return
      const e = store.error ?? prices.error ?? prods.error
      if (e || !store.data || !prices.data) return setError(errorMessage(e ?? 'Không tải được cài đặt'))
      const data = store.data
      setForm({
        is_public: data.is_public,
        public_phone: data.public_phone ?? '',
        public_tagline: data.public_tagline ?? '',
        bankCode: data.public_bank_code ?? '',
        bankAccount: data.public_bank_account ?? '',
        bankHolder: data.public_bank_holder ?? '',
        qrPayload: data.public_qr_payload ?? '',
        qrLabel: data.public_qr_label ?? '',
      })
      const initialMethod: 'qr' | 'bank' | 'none' = data.public_qr_payload?.trim()
        ? 'qr'
        : (data.public_bank_code || data.public_bank_account)
          ? 'bank'
          : 'none'
      setPayMethod(initialMethod)
      setProducts(prods.data ?? [])
      setModes(Object.fromEntries((prods.data ?? []).map((p) => [p.category ?? '', p.public_sale_mode])))
      setRules(prices.data.map((r) => ({ uid: nextUid++, size: r.set_size, productId: r.product_id ?? '', price: String(Number(r.price)) })))
    })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (error && !form) return <p className="error">{t(error)}</p>
  if (!form) return null

  const updateRule = (uid: number, patch: Partial<RuleDraft>) => setRules((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const parsed = rules.map((r) => ({ size: r.size, product_id: r.productId || null, price: Number(digits(r.price)) }))
    if (parsed.some((r) => !(r.price > 0 && r.price <= 100_000_000))) return setError('Giá set phải là số lớn hơn 0')
    const seen = new Set<string>()
    for (const r of parsed) {
      const key = `${r.size}|${r.product_id ?? ''}`
      if (seen.has(key)) return setError('Mỗi cỡ set chỉ có một giá cho cùng một loại (bị trùng dòng)')
      seen.add(key)
    }
    const account = form.bankAccount.replace(/\s/g, '')
    const holder = form.bankHolder.trim().toUpperCase()
    const qrPayload = form.qrPayload.replace(/\s/g, '')

    let saveBankCode: string | null = null
    let saveBankAccount: string | null = null
    let saveQrPayload: string | null = null
    let saveQrLabel: string | null = null
    let saveHolder: string | null = null

    if (payMethod === 'qr') {
      if (!qrPayload) return setError('Vui lòng dán chuỗi QR gốc')
      const qrError = payloadError(qrPayload)
      if (qrError) return setError(qrError)
      if (!holder) return setError('Nhập tên người nhận để hiện cùng mã QR')
      saveQrPayload = qrPayload
      saveQrLabel = form.qrLabel.trim() || 'MoMo'
      saveHolder = holder
    } else if (payMethod === 'bank') {
      if (!form.bankCode) return setError('Vui lòng chọn ngân hàng')
      if (!account || !/^\d{4,24}$/.test(account)) return setError('Số tài khoản chỉ gồm chữ số')
      if (!holder) return setError('Nhập tên chủ tài khoản')
      saveBankCode = form.bankCode
      saveBankAccount = account
      saveHolder = holder
    }

    setSaving(true)
    const { error: err } = await supabase
      .from('stores')
      .update({
        is_public: form.is_public,
        public_phone: form.public_phone.trim() || null,
        public_tagline: form.public_tagline.trim() || null,
        public_bank_code: saveBankCode,
        public_bank_account: saveBankAccount,
        public_bank_holder: saveHolder,
        public_qr_payload: saveQrPayload,
        public_qr_label: saveQrLabel,
      })
      .eq('id', storeId)
    let saved: { error: unknown } = err ? { error: err } : await supabase.rpc('save_storefront_set_prices', { p_store_id: storeId, p_rules: parsed })
    for (const [category, mode] of Object.entries(modes)) {
      if (saved.error) break
      const ids = products.filter((p) => (p.category ?? '') === category && p.public_sale_mode !== mode).map((p) => p.id)
      if (ids.length) saved = await supabase.from('products').update({ public_sale_mode: mode }).in('id', ids)
    }
    setSaving(false)
    if (saved.error) return setError(errorMessage(saved.error))
    toast.success(t('Đã lưu cài đặt trang bán hàng'))
    onSaved?.()
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('Đã sao chép liên kết'))
    } catch {
      await prompt({
        title: t('Sao chép liên kết'),
        defaultValue: link,
        confirmText: t('Đóng'),
        cancelText: '',
      })
    }
  }

  return (
    <form className="card form" onSubmit={save}>
      <label className="check">
        <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
        {t('Bật trang bán hàng cho khách (không cần đăng nhập)')}
      </label>
      <label>
        {t('Số Zalo / hotline nhận đơn')}
        <input
          type="tel"
          inputMode="tel"
          value={form.public_phone}
          onChange={(e) => setForm({ ...form, public_phone: e.target.value })}
          placeholder="0901234567"
        />
      </label>
      <label>
        {t('Câu giới thiệu dưới tên quán')}
        <input
          type="text"
          maxLength={160}
          value={form.public_tagline}
          onChange={(e) => setForm({ ...form, public_tagline: e.target.value })}
          placeholder={t('Để trống để dùng câu mặc định')}
        />
      </label>

      <h3 className="card-title">{t('Cách bán trên trang khách')}</h3>
      {Object.keys(modes).map((category) => (
        <label key={category}>
          {category || t('Chưa phân loại')}
          <select value={modes[category]} onChange={(e) => setModes((m) => ({ ...m, [category]: e.target.value as 'set' | 'single' }))}>
            <option value="set">{t('Bán theo set 4 / 6 hũ')}</option>
            <option value="single">{t('Bán lẻ từng phần')}</option>
          </select>
        </label>
      ))}

      <h3 className="card-title">{t('Giá set')}</h3>
      <small className="muted">
        {t('Mỗi dòng là giá của một loại set. "Set mix vị" áp dụng cho mọi set còn lại của dòng món có nhiều vị. Món chỉ có một vị (ví dụ bánh flan) không cần nhập: tự tính theo giá từng hũ.')}
      </small>
      {rules.map((r) => (
        <div key={r.uid} className="row rule-row">
          <label>
            {t('Cỡ set')}
            <select value={r.size} onChange={(e) => updateRule(r.uid, { size: Number(e.target.value) as 4 | 6 })}>
              <option value={4}>{t('Set 4 hũ')}</option>
              <option value={6}>{t('Set 6 hũ')}</option>
            </select>
          </label>
          <label>
            {t('Áp dụng cho')}
            <select value={r.productId} onChange={(e) => updateRule(r.uid, { productId: e.target.value })}>
              <option value="">{t('Set mix vị')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('Set toàn {name}', { name: p.name })}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Giá (đ)')}
            <input type="text" inputMode="numeric" value={r.price} onChange={(e) => updateRule(r.uid, { price: e.target.value })} placeholder="50000" />
          </label>
          <button type="button" className="link danger" onClick={() => setRules((rs) => rs.filter((x) => x.uid !== r.uid))}>
            {t('Xoá')}
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => setRules((rs) => [...rs, { uid: nextUid++, size: 4, productId: '', price: '' }])}>
          {t('Thêm giá set')}
        </button>
      </div>

      <h3 className="card-title">{t('Chuyển khoản (hiện mã QR cho khách)')}</h3>
      <div className="preset-chips" role="radiogroup" aria-label={t('Hình thức chuyển khoản')} style={{ marginBottom: '12px' }}>
        <button
          type="button"
          className={payMethod === 'qr' ? 'active' : undefined}
          onClick={() => setPayMethod('qr')}
        >
          {t('Mã QR động (MoMo / Quỹ)')}
        </button>
        <button
          type="button"
          className={payMethod === 'bank' ? 'active' : undefined}
          onClick={() => setPayMethod('bank')}
        >
          {t('Tài khoản ngân hàng')}
        </button>
        <button
          type="button"
          className={payMethod === 'none' ? 'active' : undefined}
          onClick={() => setPayMethod('none')}
        >
          {t('Không dùng chuyển khoản')}
        </button>
      </div>

      {payMethod === 'qr' && (
        <>
          <label>
            <span style={{ display: 'block', marginBottom: '4px' }}>{t('Chuỗi QR gốc (bắt đầu bằng 000201)')}</span>
            <textarea rows={3} value={form.qrPayload} onChange={(e) => setForm({ ...form, qrPayload: e.target.value })} placeholder="00020101021138…6304XXXX" spellCheck={false} />
          </label>
          {form.qrPayload.trim() && <QrCheck payload={form.qrPayload.replace(/\s/g, '')} />}
          <div className="row">
            <label style={{ minWidth: '160px', flex: 1 }}>
              <span style={{ display: 'block', marginBottom: '4px', whiteSpace: 'nowrap' }}>{t('Tên ví / ngân hàng hiện cho khách')}</span>
              <input type="text" maxLength={40} value={form.qrLabel} onChange={(e) => setForm({ ...form, qrLabel: e.target.value })} placeholder="MoMo" />
            </label>
            <label style={{ minWidth: '160px', flex: 1 }}>
              <span style={{ display: 'block', marginBottom: '4px', whiteSpace: 'nowrap' }}>{t('Tên người nhận')}</span>
              <input type="text" value={form.bankHolder} onChange={(e) => setForm({ ...form, bankHolder: e.target.value })} placeholder="NGUYEN VAN A" />
            </label>
          </div>
          <small className="muted">
            {t('Dán chuỗi QR của ví / ngân hàng (ví dụ QR Góp Quỹ MoMo). Khi khách đặt, trang tự thêm số tiền, mã hoá đơn và nội dung vào mã QR. Không có chuỗi QR thì dùng số tài khoản ngân hàng bên dưới.')}
          </small>
        </>
      )}

      {payMethod === 'bank' && (
        <>
          <div className="row">
            <label style={{ minWidth: '220px', flex: 1 }}>
              <span style={{ display: 'block', marginBottom: '4px', whiteSpace: 'nowrap' }}>{t('Ngân hàng')}</span>
              <select value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })} style={{ width: '100%' }}>
                <option value="">{t('Chọn ngân hàng')}</option>
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ minWidth: '160px', flex: 1 }}>
              <span style={{ display: 'block', marginBottom: '4px', whiteSpace: 'nowrap' }}>{t('Số tài khoản')}</span>
              <input type="text" inputMode="numeric" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
            </label>
          </div>
          <label>
            <span style={{ display: 'block', marginBottom: '4px', whiteSpace: 'nowrap' }}>{t('Tên người nhận')}</span>
            <input type="text" value={form.bankHolder} onChange={(e) => setForm({ ...form, bankHolder: e.target.value })} placeholder="NGUYEN VAN A" />
          </label>
        </>
      )}
      {error && <p className="error">{t(error)}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? t('Đang lưu…') : t('Lưu cài đặt')}
        </button>
        {form.is_public && (
          <>
            <button type="button" onClick={copyLink}>
              {t('Sao chép liên kết')}
            </button>
            <a className="button" href={link} target="_blank" rel="noopener noreferrer">
              {t('Mở trang khách')}
            </a>
          </>
        )}
      </div>
    </form>
  )
}

// Kiểm tra chuỗi QR ngay khi dán: báo lỗi hoặc hiện ví / tài khoản nhận đọc được để đối chiếu
function QrCheck({ payload }: { payload: string }) {
  const { t } = useI18n()
  const error = payloadError(payload)
  if (error) return <p className="error">{t(error)}</p>
  const info = describePayload(payload)
  const wallet = info.bin === '971025' ? 'MoMo' : info.bin
  return (
    <p className="success">
      {t('Mã QR hợp lệ: {wallet}, tài khoản {account}', { wallet: wallet ?? '—', account: info.account ?? '—' })}
    </p>
  )
}
