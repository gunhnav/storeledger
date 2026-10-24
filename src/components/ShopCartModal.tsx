import { useEffect, useMemo, useState } from 'react'
import { bankName } from '../lib/banks'
import { buildPaymentQr, describePayload } from '../lib/emvQr'
import { invoiceCode, invoiceMemo } from '../lib/invoice'
import { downloadInvoice } from '../lib/invoiceImage'
import {
  EMPTY_CUSTOMER,
  cartSummary,
  cartTotal,
  customerIssues,
  flavorColors,
  flavorEmoji,
  flavorImage,
  lineTitle,
  orderMessage,
  transferNote,
  validDomain,
  validFloor,
  vietQrUrl,
  GOOGLE_CHAT_URL,
  hangoutEmail,
  zaloLink,
  type Customer,
  type MenuItem,
  type Mix,
  type PublicStore,
  type CartLine,
} from '../lib/storefront'

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

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
  cart: CartLine[]
  items: MenuItem[]
  store: PublicStore
  onSetLineQty: (key: string, qty: number) => void
  salt: string
  openedAt: Date
}

export function ShopCartModal({ open, onClose, cart, items, store, onSetLineQty, salt, openedAt }: ShopCartModalProps) {
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER)
  const [tried, setTried] = useState(false)
  const [copied, setCopied] = useState(false)
  // Lỗi khi tạo ảnh hoá đơn / mã QR (hiện ngay trong hộp thoại thay vì alert)
  const [fileError, setFileError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [qrImage, setQrImage] = useState<{ text: string; url: string } | null>(null)

  // Đóng hộp thoại bằng phím Esc
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const total = useMemo(() => cartTotal(cart), [cart])
  const issues = useMemo(() => customerIssues(customer), [customer])
  const ready = cart.length > 0 && Object.keys(issues).length === 0

  const { bank, pay } = store
  const canTransfer = !!(pay || bank)
  const payByTransfer = canTransfer && customer.payment === 'transfer'

  // Chuỗi QR có số tiền + số hoá đơn của đơn hiện tại
  const orderCode = useMemo(() => {
    const cartHash = `${salt}|${cart.map((l) => `${l.key}x${l.qty}`).join(',')}`
    return invoiceCode(openedAt, cartHash)
  }, [openedAt, salt, cart])

  // Nội dung chuyển khoản "domain - F tầng" (vd: huong.vu3 - F6); khi khách chưa điền đủ thì tạm dùng mã đơn
  const memo = useMemo(
    () => (validDomain(customer.domain) && validFloor(customer.floor) ? transferNote(customer.domain, customer.floor) : invoiceMemo(orderCode, 'Hogi')),
    [customer.domain, customer.floor, orderCode],
  )

  const qrText = useMemo(() => {
    if (!pay || !payByTransfer || total <= 0) return null
    try {
      return buildPaymentQr(pay.payload, total, memo, orderCode)
    } catch {
      return null
    }
  }, [pay, payByTransfer, total, memo, orderCode])

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

  const message = useMemo(
    () => orderMessage(store.name, cart, items, customer, canTransfer, orderCode),
    [store.name, cart, items, customer, canTransfer, orderCode],
  )

  const setField = (patch: Partial<Customer>) => setCustomer((c) => ({ ...c, ...patch }))

  const copy = async (): Promise<boolean> => {
    if (!ready) {
      setTried(true)
      return false
    }
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Sao chép nội dung đơn hàng:', message)
    }
    return true
  }

  // Kênh gửi đơn: Hangout (Google Chat) nếu quán có domain, không thì Zalo theo số điện thoại
  const channel = store.domain ? 'Hangout' : store.phone ? 'Zalo' : null
  // Gọi trực tiếp window.open trong sự kiện click để trình duyệt điện thoại không chặn popup
  const sendOrder = () => {
    if (!ready) {
      setTried(true)
      return
    }
    navigator.clipboard?.writeText(message).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    if (store.domain) window.open(GOOGLE_CHAT_URL, '_blank', 'noopener')
    else if (store.phone) window.open(zaloLink(store.phone), '_blank', 'noopener')
  }

  // Tải ảnh mã QR thanh toán về máy (để mở MoMo quét từ thư viện ảnh)
  const saveQr = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `QR-${orderCode}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const saveInvoice = async () => {
    if (!ready) {
      setTried(true)
      return
    }
    setDownloading(true)
    setFileError(null)
    try {
      await downloadInvoice({
        storeName: store.name,
        storePhone: store.phone,
        storeDomain: store.domain,
        code: orderCode,
        issuedAt: new Date(),
        customer,
        lines: cart.map((l) => {
          const { title, detail } = lineTitle(l, items)
          return { title, detail, qty: l.qty, unitPrice: l.unitPrice }
        }),
        total,
        paymentText: !canTransfer ? 'Liên hệ quán' : customer.payment === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt khi nhận',
        qr:
          payByTransfer && pay && qrUrl
            ? { dataUrl: qrUrl, holder: pay.holder, label: pay.label ?? '', account: payAccount ?? '', memo }
            : payByTransfer && bank
              ? { dataUrl: vietQrUrl(bank, total, memo), holder: bank.holder, label: bankName(bank.code), account: bank.account, memo }
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
    <div className="shop-modal-backdrop" onClick={onClose}>
      <div className="shop-modal" role="dialog" aria-modal="true" aria-label="Đơn đặt trước của bạn" onClick={(e) => e.stopPropagation()}>
        <div className="shop-modal-head">
          <h3>Đơn đặt trước của bạn 🥣</h3>
          <button type="button" aria-label="Đóng" onClick={onClose}>
            ×
          </button>
        </div>

        {cart.length === 0 ? (
          <p className="shop-state">Chưa có set nào trong đơn. Chọn set rồi quay lại đây nhé!</p>
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
                      <button type="button" aria-label={l.qty <= 1 ? 'Xoá set' : 'Giảm'} onClick={() => onSetLineQty(l.key, l.qty - 1)}>
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
                <input type="text" value={customer.domain} onChange={(e) => setField({ domain: e.target.value })} placeholder="Domain * (vd: huong.vu3)" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                {err('domain')}
              </label>
              <label className="shop-field shop-field-floor">
                <input type="text" inputMode="numeric" value={customer.floor} onChange={(e) => setField({ floor: e.target.value })} placeholder="Tầng *" />
                {err('floor')}
              </label>
            </div>

            <p className="shop-order-code">
              Mã đơn: <strong>{orderCode}</strong>
            </p>

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
              </>
            )}

            {payByTransfer && pay && (
              <div className="shop-bank">
                <h4>Quét mã để thanh toán</h4>
                {qrUrl ? <img src={qrUrl} alt={`Mã QR thanh toán ${vnd(total)}`} width={240} height={240} data-payload={qrText ?? undefined} /> : <div className="shop-qr-wait">Đang tạo mã QR…</div>}
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
                  <dd className="shop-bank-amount">{vnd(total)}</dd>
                  <dt>Nội dung</dt>
                  <dd>{memo}</dd>
                </dl>
                {qrUrl && (
                  <button type="button" className="shop-copy shop-download" onClick={() => saveQr(qrUrl)}>
                    ⬇ Tải mã QR
                  </button>
                )}
                <small className="shop-hint">Mã QR đã có sẵn số tiền và nội dung. Mở MoMo hoặc ứng dụng ngân hàng để quét, hoặc tải mã về rồi quét từ thư viện ảnh.</small>
              </div>
            )}

            {payByTransfer && !pay && bank && (
              <div className="shop-bank">
                <h4>Chuyển khoản ngân hàng</h4>
                <img src={vietQrUrl(bank, total, memo)} alt={`Mã QR chuyển khoản ${vnd(total)}`} width={220} height={220} loading="lazy" />
                <dl>
                  <dt>Ngân hàng</dt>
                  <dd>{bankName(bank.code)}</dd>
                  <dt>Số tài khoản</dt>
                  <dd>{bank.account}</dd>
                  <dt>Chủ tài khoản</dt>
                  <dd>{bank.holder}</dd>
                  <dt>Số tiền</dt>
                  <dd className="shop-bank-amount">{vnd(total)}</dd>
                  <dt>Nội dung</dt>
                  <dd>{memo}</dd>
                </dl>
              </div>
            )}

            {channel ? (
              <button type="button" className="shop-send" onClick={sendOrder}>
                Gửi đơn qua {channel}
              </button>
            ) : null}
            <button type="button" className={channel ? 'shop-copy' : 'shop-send'} onClick={copy}>
              {copied ? 'Đã sao chép ✓' : 'Sao chép đơn hàng'}
            </button>
            <button type="button" className="shop-copy shop-download" onClick={saveInvoice} disabled={downloading}>
              {downloading ? 'Đang tạo hoá đơn…' : '⬇ Tải hoá đơn về máy'}
            </button>
            {tried && !ready && <small className="shop-error">Bạn điền đủ tên, domain và tầng giúp quán nhé.</small>}
            {fileError && <small className="shop-error">{fileError}</small>}
            <small className="shop-hint">
              {store.domain
                ? `Bấm "Gửi đơn qua Hangout": nội dung đơn được sao chép sẵn. Trong Google Chat, tìm ${hangoutEmail(store.domain)} rồi dán vào khung chat.`
                : store.phone
                  ? 'Bấm "Gửi đơn qua Zalo": nội dung đơn được sao chép sẵn, bạn chỉ cần dán vào khung chat.'
                  : 'Sao chép đơn rồi gửi cho cửa hàng để đặt trước.'}
            </small>
          </>
        )}
      </div>
    </div>
  )
}
