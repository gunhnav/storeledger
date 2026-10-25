import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { bankName } from '../lib/banks'
import { buildPaymentQr, describePayload } from '../lib/emvQr'
import { downloadInvoice } from '../lib/invoiceImage'
import {
  EMPTY_CUSTOMER,
  cartSummary,
  cartTotal,
  cleanDomain,
  cleanFloor,
  customerIssues,
  flavorColors,
  flavorEmoji,
  flavorImage,
  lineTitle,
  preorderPayload,
  transferNote,
  vietQrUrl,
  type CartLine,
  type Customer,
  type MenuItem,
  type Mix,
  type PlacedOrder,
  type PublicStore,
} from '../lib/storefront'

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
// Thời điểm lập hoá đơn (gọi trong lúc bấm nút, không phải lúc vẽ)
const now = () => new Date()

// Hình các vị trong một set (tối đa 3 hình chồng nhau) để nhận ra set trong đơn
export function SetThumbs({ mix, items }: { mix: Mix; items: MenuItem[] }) {
  const flavors = items.filter((i) => (mix[i.id] ?? 0) > 0).slice(0, 3)
  return (
    <div className="shop-thumbs" aria-hidden="true">
      {flavors.map((f) => {
        const image = flavorImage(f.name)
        const [c1, c2] = flavorColors(f.name)
        return (
          <span key={f.id} style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
            {image ? <img src={image} alt="" width={44} height={44} /> : flavorEmoji(f.name)}
          </span>
        )
      })}
    </div>
  )
}

interface ShopCartModalProps {
  open: boolean
  onClose: () => void
  // Mã quán (gửi kèm đơn lên máy chủ)
  storeCode: string
  cart: CartLine[]
  items: MenuItem[]
  store: PublicStore
  onSetLineQty: (key: string, qty: number) => void
  // Máy chủ đã ghi nhận đơn: trang xoá giỏ hàng để khách đặt đơn khác
  onPlaced: () => void
}

// Hộp thoại đơn đặt trước. Luồng: điền tên, domain, tầng -> bấm "Đặt hàng" (máy chủ kiểm tra, tự tính lại giá, cấp mã đơn và
// báo cho quán) -> lúc đó mới hiện mã QR chuyển khoản có sẵn số tiền + nội dung, kèm tải QR / tải hoá đơn / nhắn Hangout.
export function ShopCartModal({ open, onClose, storeCode, cart, items, store, onSetLineQty, onPlaced }: ShopCartModalProps) {
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER)
  const [tried, setTried] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<PlacedOrder | null>(null)
  // Lỗi khi tạo ảnh hoá đơn / mã QR (hiện ngay trong hộp thoại thay vì alert)
  const [fileError, setFileError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [qrImage, setQrImage] = useState<{ text: string; url: string } | null>(null)

  // Đóng hộp thoại; nếu vừa đặt xong thì lần mở sau là đơn mới
  const close = () => {
    if (placed) setPlaced(null)
    onClose()
  }

  // Đóng hộp thoại bằng phím Esc
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const total = useMemo(() => cartTotal(cart), [cart])
  const issues = useMemo(() => customerIssues(customer, store.floors), [customer, store.floors])
  const ready = cart.length > 0 && Object.keys(issues).length === 0

  const { bank, pay } = store
  const canTransfer = !!(pay || bank)
  const payByTransfer = canTransfer && customer.payment === 'transfer'
  // Nội dung chuyển khoản "domain - F tầng" (vd: huong.vu3 - F6)
  const memo = transferNote(customer.domain, customer.floor)

  // QR chỉ có sau khi máy chủ ghi nhận đơn: số tiền là tổng máy chủ tính, số hoá đơn là mã đơn máy chủ cấp
  const qrText = useMemo(() => {
    if (!placed || !pay || !payByTransfer) return null
    try {
      return buildPaymentQr(pay.payload, placed.total, memo, placed.code)
    } catch {
      return null
    }
  }, [placed, pay, payByTransfer, memo])

  useEffect(() => {
    if (!qrText) return
    let cancelled = false
    import('qrcode')
      .then((QR) => QR.toDataURL(qrText, { errorCorrectionLevel: 'M', margin: 1, width: 520 }))
      .then((url) => {
        if (!cancelled) setQrImage({ text: qrText, url })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [qrText])

  const qrUrl = qrText && qrImage?.text === qrText ? qrImage.url : null
  const payAccount = useMemo(() => {
    if (!pay) return null
    try {
      return describePayload(pay.payload).account
    } catch {
      return null
    }
  }, [pay])

  const setField = (patch: Partial<Customer>) => setCustomer((c) => ({ ...c, ...patch }))

  // Gửi đơn lên máy chủ: máy chủ kiểm tra lại mọi thứ và tự tính giá
  const placeOrder = async () => {
    if (!ready) return setTried(true)
    setSubmitting(true)
    setSubmitError(null)
    const { data, error } = await supabase.rpc('submit_preorder', { p_store_code: storeCode, p_order: preorderPayload(cart, customer) })
    setSubmitting(false)
    if (error || !data) return setSubmitError(error?.message ?? 'Chưa gửi được đơn, bạn thử lại nhé.')
    setPlaced({ code: data.code, total: Number(data.total), lines: data.lines.map((l) => ({ ...l, unit_price: Number(l.unit_price) })) })
    onPlaced()
  }

  // Tải ảnh mã QR thanh toán về máy (để mở MoMo quét từ thư viện ảnh)
  const saveQr = (url: string) => {
    if (!placed) return
    const a = document.createElement('a')
    a.href = url
    a.download = `QR-${placed.code}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const saveInvoice = async () => {
    if (!placed) return
    setDownloading(true)
    setFileError(null)
    try {
      await downloadInvoice({
        storeName: store.name,
        storePhone: store.phone,
        storeDomain: store.domain,
        code: placed.code,
        issuedAt: now(),
        customer,
        lines: placed.lines.map((l) => ({ title: l.title, detail: l.detail, qty: l.qty, unitPrice: l.unit_price })),
        total: placed.total,
        paymentText: payByTransfer ? 'Chuyển khoản' : 'Tiền mặt khi nhận',
        qr:
          payByTransfer && pay && qrUrl
            ? { dataUrl: qrUrl, holder: pay.holder, label: pay.label ?? '', account: payAccount ?? '', memo }
            : payByTransfer && bank
              ? { dataUrl: vietQrUrl(bank, placed.total, memo), holder: bank.holder, label: bankName(bank.code), account: bank.account, memo }
              : null,
      })
    } catch {
      setFileError('Không tạo được hoá đơn, bạn thử lại nhé.')
    } finally {
      setDownloading(false)
    }
  }

  if (!open) return null

  const err = (k: 'name' | 'domain' | 'floor') => (tried && issues[k] ? <small className="shop-error">{issues[k]}</small> : null)

  return (
    <div className="shop-modal-backdrop" onClick={close}>
      <div className="shop-modal" role="dialog" aria-modal="true" aria-label="Đơn đặt trước của bạn" onClick={(e) => e.stopPropagation()}>
        <div className="shop-modal-head">
          <h3>{placed ? 'Đặt hàng thành công 🎉' : 'Đơn đặt trước của bạn 🥣'}</h3>
          <button type="button" aria-label="Đóng" onClick={close}>
            ×
          </button>
        </div>

        {placed ? (
          <>
            <div className="shop-success" role="status">
              <strong>Quán đã nhận đơn {placed.code}</strong>
              <p>
                {payByTransfer
                  ? 'Bạn quét mã QR bên dưới để chuyển khoản, số tiền và nội dung đã có sẵn trong mã.'
                  : 'Bạn thanh toán tiền mặt khi nhận hàng nhé.'}
              </p>
            </div>

            <ul className="shop-lines shop-lines-done">
              {placed.lines.map((l, i) => (
                <li key={i}>
                  <div className="shop-line-info">
                    <strong>
                      {l.qty} × {l.title}
                    </strong>
                    <small>{l.detail}</small>
                  </div>
                  <strong>{vnd(l.unit_price * l.qty)}</strong>
                </li>
              ))}
            </ul>
            <div className="shop-total">
              <span>Tổng thanh toán</span>
              <strong>{vnd(placed.total)}</strong>
            </div>
            <p className="shop-order-code">
              {customer.name.trim()} · {cleanDomain(customer.domain)} · Tầng {cleanFloor(customer.floor)}
            </p>

            {payByTransfer && pay && (
              <div className="shop-bank">
                <h4>Quét mã để thanh toán</h4>
                {qrUrl ? <img src={qrUrl} alt={`Mã QR thanh toán ${vnd(placed.total)}`} width={240} height={240} data-payload={qrText ?? undefined} /> : <div className="shop-qr-wait">Đang tạo mã QR…</div>}
                <dl>
                  <dt>Người nhận</dt>
                  <dd>{pay.holder}</dd>
                  {pay.label && (
                    <>
                      <dt>Ví / ngân hàng</dt>
                      <dd>{pay.label}</dd>
                    </>
                  )}
                  {payAccount && (
                    <>
                      <dt>Tài khoản</dt>
                      <dd>{payAccount}</dd>
                    </>
                  )}
                  <dt>Số tiền</dt>
                  <dd className="shop-bank-amount">{vnd(placed.total)}</dd>
                  <dt>Nội dung</dt>
                  <dd>{memo}</dd>
                </dl>
                {qrUrl && (
                  <button type="button" className="shop-copy shop-download" onClick={() => saveQr(qrUrl)}>
                    ⬇ Tải mã QR
                  </button>
                )}
                <small className="shop-hint">Mở MoMo hoặc ứng dụng ngân hàng để quét, hoặc tải mã về rồi quét từ thư viện ảnh.</small>
              </div>
            )}

            {payByTransfer && !pay && bank && (
              <div className="shop-bank">
                <h4>Chuyển khoản ngân hàng</h4>
                <img src={vietQrUrl(bank, placed.total, memo)} alt={`Mã QR chuyển khoản ${vnd(placed.total)}`} width={220} height={220} loading="lazy" />
                <dl>
                  <dt>Ngân hàng</dt>
                  <dd>{bankName(bank.code)}</dd>
                  <dt>Số tài khoản</dt>
                  <dd>{bank.account}</dd>
                  <dt>Chủ tài khoản</dt>
                  <dd>{bank.holder}</dd>
                  <dt>Số tiền</dt>
                  <dd className="shop-bank-amount">{vnd(placed.total)}</dd>
                  <dt>Nội dung</dt>
                  <dd>{memo}</dd>
                </dl>
              </div>
            )}

            <button type="button" className="shop-copy shop-download" onClick={saveInvoice} disabled={downloading}>
              {downloading ? 'Đang tạo hoá đơn…' : '⬇ Tải hoá đơn về máy'}
            </button>
            {fileError && <small className="shop-error">{fileError}</small>}
            <button type="button" className="shop-send" onClick={close}>
              Xong, đặt đơn khác
            </button>
          </>
        ) : cart.length === 0 ? (
          <p className="shop-state">Chưa có món nào trong đơn. Chọn set hoặc món lẻ rồi quay lại đây nhé!</p>
        ) : (
          <>
            <ul className="shop-lines">
              {cart.map((l) => {
                const info = lineTitle(l, items)
                return (
                  <li key={l.key}>
                    <SetThumbs mix={l.kind === 'set' ? l.mix : { [l.productId]: l.qty }} items={items} />
                    <div className="shop-line-info">
                      <strong>{info.title}</strong>
                      <small>{info.detail}</small>
                      <small>
                        {vnd(l.unitPrice)} / {info.unit}
                      </small>
                    </div>
                    <div className="shop-qty">
                      <button type="button" aria-label={l.qty <= 1 ? 'Xoá' : 'Giảm'} onClick={() => onSetLineQty(l.key, l.qty - 1)}>
                        {l.qty <= 1 ? (
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                          </svg>
                        ) : (
                          '−'
                        )}
                      </button>
                      <span>{l.qty}</span>
                      <button type="button" aria-label="Tăng" onClick={() => onSetLineQty(l.key, l.qty + 1)}>
                        +
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="shop-total">
              <span>Tổng thanh toán · {cartSummary(cart)}</span>
              <strong>{vnd(total)}</strong>
            </div>

            <h4 className="shop-modal-title">📋 Thông tin nhận hàng</h4>
            <label className="shop-field">
              <input type="text" value={customer.name} onChange={(e) => setField({ name: e.target.value })} placeholder="Tên của bạn *" autoComplete="name" />
              {err('name')}
            </label>
            <div className="shop-field-row">
              <label className="shop-field">
                <input type="text" value={customer.domain} onChange={(e) => setField({ domain: e.target.value })} placeholder="Domain *" title="Domain nội bộ, vd: huong.vu3" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                {err('domain')}
              </label>
              <label className="shop-field shop-field-floor">
                {store.floors ? (
                  <select value={customer.floor} onChange={(e) => setField({ floor: e.target.value })} aria-label="Tầng">
                    <option value="">Tầng *</option>
                    {store.floors.map((f) => (
                      <option key={f} value={f}>
                        Tầng {f}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" inputMode="numeric" value={customer.floor} onChange={(e) => setField({ floor: e.target.value })} placeholder="Tầng *" />
                )}
                {err('floor')}
              </label>
            </div>

            {canTransfer && (
              <>
                <h4 className="shop-modal-title">💳 Thanh toán</h4>
                <div className="shop-pay" role="radiogroup" aria-label="Hình thức thanh toán">
                  <button type="button" role="radio" aria-checked={customer.payment === 'transfer'} className={customer.payment === 'transfer' ? 'active' : undefined} onClick={() => setField({ payment: 'transfer' })}>
                    Chuyển khoản
                  </button>
                  <button type="button" role="radio" aria-checked={customer.payment === 'cash'} className={customer.payment === 'cash' ? 'active' : undefined} onClick={() => setField({ payment: 'cash' })}>
                    Tiền mặt khi nhận
                  </button>
                </div>
                {payByTransfer && (
                  <p className="shop-notice">
                    🔒 Mã QR chuyển khoản sẽ hiện sau khi bạn điền đủ <b>tên, domain, tầng</b> và bấm <b>Đặt hàng</b>. Số tiền và nội dung có sẵn trong mã.
                  </p>
                )}
              </>
            )}

            <button type="button" className="shop-send" onClick={placeOrder} disabled={submitting}>
              {submitting ? 'Đang gửi đơn…' : `Đặt hàng · ${vnd(total)}`}
            </button>
            {tried && !ready && <small className="shop-error">Bạn điền đủ tên, domain và chọn tầng giúp quán nhé.</small>}
            {submitError && <small className="shop-error">{submitError}</small>}
            <small className="shop-hint">Bấm "Đặt hàng" là quán nhận được đơn ngay, không cần nhắn thêm.</small>
          </>
        )}
      </div>
    </div>
  )
}
