import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { bankName } from '../lib/banks'
import { buildPaymentQr, describePayload } from '../lib/emvQr'
import { invoiceCode, invoiceMemo, randomSalt } from '../lib/invoice'
import { downloadInvoice } from '../lib/invoiceImage'
import {
  EMPTY_CUSTOMER,
  SET_SIZES,
  addSet,
  cartJars,
  cartSets,
  cartTotal,
  changeMix,
  customerIssues,
  flavorColors,
  flavorImage,
  flavorNote,
  lineOf,
  menuLines,
  mixCount,
  mixLabel,
  orderMessage,
  refreshCart,
  selectable,
  setLineQty,
  setPrice,
  setPriceHints,
  telLink,
  vietQrUrl,
  zaloLink,
  type Customer,
  type MenuItem,
  type Mix,
  type PublicMenu,
  type SetLine,
  type SetSize,
} from '../lib/storefront'

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
const REFRESH_MS = 60_000
// Thời điểm lập hoá đơn (gọi trong lúc bấm nút, không phải lúc vẽ)
const now = () => new Date()

// Hình các vị trong một set (tối đa 3 hình chồng nhau) để nhận ra set trong đơn
function SetThumbs({ mix, items }: { mix: Mix; items: MenuItem[] }) {
  const flavors = items.filter((i) => (mix[i.id] ?? 0) > 0).slice(0, 3)
  return (
    <div className="shop-thumbs" aria-hidden="true">
      {flavors.map((f) => {
        const image = flavorImage(f.name)
        const [c1, c2] = flavorColors(f.name)
        return (
          <span key={f.id} style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
            {image ? <img src={image} alt="" width={44} height={44} /> : '🥣'}
          </span>
        )
      })}
    </div>
  )
}

// Trang đặt trước của một quán (/hogi, /shop/<mã quán>): khách không cần đăng nhập.
// Bán theo SET 4 hoặc 6 hũ, khách tự chọn vị cho từng set (giống kênh Công ty). Không lấy tồn kho: ai đặt gì nhận đó.
// Tiếng Việt cố định vì dành cho khách của quán (không đi qua bộ dịch của app).
export function ShopPage({ code: fixedCode }: { code?: string }) {
  const params = useParams()
  const code = (fixedCode ?? params.code ?? '').toLowerCase()
  const [menu, setMenu] = useState<PublicMenu | null | undefined>(undefined)
  const [error, setError] = useState(false)
  const [cart, setCart] = useState<SetLine[]>([])
  // Set đang soạn: cỡ, số hũ từng vị, và số set giống hệt muốn đặt
  const [line, setLine] = useState('')
  const [size, setSize] = useState<SetSize>(4)
  const [mix, setMix] = useState<Mix>({})
  const [copies, setCopies] = useState(1)
  const [open, setOpen] = useState(false)
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER)
  // Đã bấm gửi đơn khi còn thiếu thông tin: lúc đó mới hiện lỗi từng ô
  const [tried, setTried] = useState(false)
  const [copied, setCopied] = useState(false)
  const [accountCopied, setAccountCopied] = useState(false)
  // Mã ngẫu nhiên của lượt truy cập: mã hoá đơn = ngày + băm(mã này + giỏ hàng), giữ nguyên khi khách đang điền thông tin
  const [salt] = useState(() => randomSalt())
  // Ngày lập mã đơn: lấy lúc mở trang (không đổi giữa các lần vẽ lại)
  const [openedAt] = useState(() => new Date())
  const [qrImage, setQrImage] = useState<{ text: string; url: string } | null>(null)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_public_menu', { p_store_code: code })
    if (e) return setError(true)
    setError(false)
    const next: PublicMenu | null = data ?? null
    setMenu(next)
    // Cập nhật giá mới và bỏ vị đã gỡ khỏi thực đơn
    if (next) {
      setCart((c) => refreshCart(c, next.items, next.store))
      setMix((m) => Object.fromEntries(Object.entries(m).filter(([id]) => next.items.some((i) => i.id === id))))
    }
  }, [code])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (menu) document.title = `${menu.store.name} – Đặt trước online`
  }, [menu])

  // Đóng hộp thoại bằng phím Esc
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Chuỗi QR có số tiền + số hoá đơn của đơn hiện tại (nếu quán có QR gốc và khách chọn chuyển khoản)
  const orderCode = invoiceCode(openedAt, `${salt}|${cart.map((l) => `${l.key}x${l.qty}`).join(',')}`)
  const orderTotal = cartTotal(cart)
  let qrText: string | null = null
  if (menu?.store.pay && customer.payment === 'transfer' && orderTotal > 0) {
    try {
      qrText = buildPaymentQr(menu.store.pay.payload, orderTotal, invoiceMemo(orderCode, 'Hogi'), orderCode)
    } catch {
      qrText = null
    }
  }

  useEffect(() => {
    if (!qrText || qrImage?.text === qrText) return
    let cancelled = false
    import('qrcode')
      .then((QR) => QR.toDataURL(qrText, { errorCorrectionLevel: 'M', margin: 1, width: 520 }))
      .then((url) => !cancelled && setQrImage({ text: qrText, url }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [qrText, qrImage?.text])

  if (menu === undefined && !error) return <div className="shop"><p className="shop-state">Đang tải thực đơn…</p></div>
  if (error) {
    return (
      <div className="shop">
        <p className="shop-state">Không tải được thực đơn. Bạn thử tải lại trang nhé.</p>
      </div>
    )
  }
  if (!menu) {
    return (
      <div className="shop">
        <p className="shop-state">Không tìm thấy cửa hàng này.</p>
      </div>
    )
  }

  const { store, items } = menu
  const picked = mixCount(mix)
  const lines = menuLines(items)
  const activeLine = lines.includes(line) ? line : (lines[0] ?? '')
  const lineItems = items.filter((i) => lineOf(i) === activeLine)
  const unitPrice = picked === size ? setPrice(size, mix, items, store) : null
  // Giá trên nút chọn cỡ set; dòng món tính theo từng hũ (vd: bánh flan) thì thẻ món hiện giá một hũ
  const hints = (s: SetSize) => setPriceHints(s, lineItems, store)
  const perJar = hints(size).length === 1 && hints(size)[0].label === null
  const total = cartTotal(cart)
  const sets = cartSets(cart)
  const issues = customerIssues(customer)
  const ready = cart.length > 0 && Object.keys(issues).length === 0
  const bank = store.bank
  const pay = store.pay
  const canTransfer = !!(pay || bank)
  const payByTransfer = canTransfer && customer.payment === 'transfer'
  const memo = invoiceMemo(orderCode, 'Hogi')
  const payAccount = pay ? (() => { try { return describePayload(pay.payload).account } catch { return null } })() : null
  const qrUrl = qrText && qrImage?.text === qrText ? qrImage.url : null
  const message = orderMessage(store.name, cart, items, customer, canTransfer, orderCode)
  const setField = (patch: Partial<Customer>) => setCustomer((c) => ({ ...c, ...patch }))

  const chooseSize = (s: SetSize) => {
    setSize(s)
    setMix({})
    setCopies(1)
  }
  const chooseLine = (l: string) => {
    setLine(l)
    setMix({})
    setCopies(1)
  }
  const addToCart = () => {
    setCart((c) => addSet(c, size, mix, copies, items, store))
    setMix({})
    setCopies(1)
  }
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
  const sendZalo = async () => {
    if (await copy()) if (store.phone) window.open(zaloLink(store.phone), '_blank', 'noopener')
  }
  const copyAccount = async (account: string) => {
    try {
      await navigator.clipboard.writeText(account)
      setAccountCopied(true)
      setTimeout(() => setAccountCopied(false), 2000)
    } catch {
      window.prompt('Sao chép số tài khoản:', account)
    }
  }
  // Tải ảnh hoá đơn (PNG) về máy; cần đủ thông tin khách như khi gửi đơn
  const saveInvoice = async () => {
    if (!ready) return setTried(true)
    setDownloading(true)
    try {
      await downloadInvoice({
        storeName: store.name,
        storePhone: store.phone,
        code: orderCode,
        issuedAt: now(),
        customer,
        lines: cart.map((l) => ({ title: `Set ${l.size} hũ`, detail: mixLabel(l.mix, items), qty: l.qty, unitPrice: l.unitPrice })),
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
      window.alert('Không tạo được hoá đơn, bạn thử lại nhé.')
    } finally {
      setDownloading(false)
    }
  }
  const err = (k: 'name' | 'phone' | 'address') => (tried && issues[k] ? <small className="shop-error">{issues[k]}</small> : null)

  const cartIcon = (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6" />
    </svg>
  )

  return (
    <div className="shop" id="top">
      <header className="shop-header">
        <div className="shop-header-in">
          <a className="shop-brand" href="#top">
            <img className="shop-logo" src="/shop/hogi-mark.svg" alt="" width={40} height={40} />
            <strong>{store.name}</strong>
          </a>
          <nav className="shop-nav" aria-label="Điều hướng">
            <a href="#chon-set">Chọn set</a>
            <a href="#cach-dat">Cách đặt hàng</a>
            <a href="#lien-he">Liên hệ</a>
          </nav>
          <div className="shop-header-actions">
            {store.phone && (
              <a className="shop-contact" href={zaloLink(store.phone)} target="_blank" rel="noopener noreferrer">
                Nhắn Zalo
              </a>
            )}
            <button type="button" className="shop-cart-btn" aria-label={`Đơn hàng, ${sets} set`} onClick={() => setOpen(true)}>
              {cartIcon}
              {sets > 0 && <span className="shop-cart-count">{sets}</span>}
            </button>
          </div>
        </div>
      </header>

      <section className="shop-hero">
        <div className="shop-hero-in">
          <div className="shop-hero-copy">
            <span className="shop-eyebrow">{store.name} · Đặt trước</span>
            <h1>
              Sữa chua hũ,
              <em>đặt trước theo set.</em>
            </h1>
            <p>{store.tagline || 'Chọn set 4 hoặc 6 hũ, tự mix vị bạn thích rồi gửi đơn qua Zalo.'}</p>
            <div className="shop-hero-cta">
              <a className="shop-cta" href="#chon-set">
                Chọn set ngay
              </a>
              <a className="shop-cta shop-cta-ghost" href="#cach-dat">
                Cách đặt hàng
              </a>
            </div>
          </div>
          <img className="shop-hero-art" src="/shop/hero.svg" alt="Chú hũ sữa chua Hogi cùng các vị phô mai, matcha, ca cao, nếp cẩm" width={640} height={420} />
        </div>
      </section>

      <ul className="shop-points">
        <li>
          <span aria-hidden="true">🥣</span>
          <div>
            <strong>Set 4 hoặc 6 hũ</strong>
            <small>Đặt theo set, nhiều set cũng được</small>
          </div>
        </li>
        <li>
          <span aria-hidden="true">🎨</span>
          <div>
            <strong>Tự chọn vị</strong>
            <small>{items.filter((i) => lineOf(i) === lines[0]).length} vị, mix thoải mái trong một set</small>
          </div>
        </li>
        <li>
          <span aria-hidden="true">💬</span>
          <div>
            <strong>Gửi đơn qua Zalo</strong>
            <small>Đơn soạn sẵn, chỉ cần gửi</small>
          </div>
        </li>
      </ul>

      <main id="chon-set" className="shop-menu">
        <div className="shop-menu-head">
          <p className="shop-kicker">Đặt trước theo set</p>
          <h2>Tự soạn set của bạn</h2>
          <p className="shop-sub">Chọn cỡ set, rồi chọn số hũ cho từng vị đến khi đủ.</p>
        </div>

        {items.length === 0 ? (
          <p className="shop-state">Thực đơn đang được cập nhật.</p>
        ) : (
          <>
            {lines.length > 1 && (
              <div className="shop-tabs" role="tablist" aria-label="Loại món">
                {lines.map((l) => (
                  <button key={l} type="button" role="tab" aria-selected={activeLine === l} className={activeLine === l ? 'active' : undefined} onClick={() => chooseLine(l)}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            <div className="shop-sizes" role="radiogroup" aria-label="Cỡ set">
              {SET_SIZES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={size === s} className={`shop-size${size === s ? ' active' : ''}`} onClick={() => chooseSize(s)}>
                  <strong>Set {s} hũ</strong>
                  {hints(s).length === 0 ? (
                    <span>Giá cộng theo từng hũ</span>
                  ) : (
                    hints(s).map((h) => (
                      <span key={h.label ?? 'all'}>
                        {h.label ? `${h.label}: ` : ''}
                        <b>{vnd(h.price)}</b>
                      </span>
                    ))
                  )}
                </button>
              ))}
            </div>

            <div className="shop-grid">
              {lineItems.map((item) => {
                const [c1, c2] = flavorColors(item.name)
                const image = flavorImage(item.name)
                const note = flavorNote(item.name)
                const n = mix[item.id] ?? 0
                const ok = selectable(item, size, store)
                return (
                  <article key={item.id} className={`shop-card${n > 0 ? ' is-picked' : ''}${ok ? '' : ' is-out'}`}>
                    <div className="shop-art" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} aria-hidden="true">
                      {image ? <img src={image} alt="" loading="lazy" width={520} height={430} /> : <span>🥣</span>}
                      {n > 0 && <span className="shop-picked">{n}</span>}
                    </div>
                    <div className="shop-body">
                      <div className="shop-title">
                        <h4>{item.name}</h4>
                        {note && <p className="shop-note">{note}</p>}
                      </div>
                      {perJar && item.price !== null && (
                        <p className="shop-price">
                          {vnd(item.price)}
                          <small> / hũ</small>
                        </p>
                      )}
                      {ok ? (
                        <div className="shop-qty" role="group" aria-label={`Số hũ ${item.name}`}>
                          <button type="button" aria-label={`Bớt ${item.name}`} disabled={n === 0} onClick={() => setMix((m) => changeMix(m, item.id, -1, size))}>
                            −
                          </button>
                          <span>{n}</span>
                          <button type="button" aria-label={`Thêm ${item.name}`} disabled={picked >= size} onClick={() => setMix((m) => changeMix(m, item.id, 1, size))}>
                            +
                          </button>
                        </div>
                      ) : (
                        <p className="shop-note">Chưa có giá</p>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>

            <div className="shop-builder" aria-live="polite">
              <div className="shop-builder-info">
                <div className="shop-dots" aria-hidden="true">
                  {Array.from({ length: size }, (_, i) => (
                    <span key={i} className={i < picked ? 'on' : undefined} />
                  ))}
                </div>
                <div>
                  <strong>
                    Set {size} hũ: đã chọn {picked}/{size}
                  </strong>
                  <p>{picked > 0 ? mixLabel(mix, items) : 'Bấm + ở các vị bên trên để chọn.'}</p>
                </div>
              </div>
              <div className="shop-builder-actions">
                <div className="shop-qty" role="group" aria-label="Số set giống nhau">
                  <button type="button" aria-label="Giảm số set" disabled={copies <= 1} onClick={() => setCopies((c) => Math.max(1, c - 1))}>
                    −
                  </button>
                  <span>{copies}</span>
                  <button type="button" aria-label="Tăng số set" onClick={() => setCopies((c) => Math.min(99, c + 1))}>
                    +
                  </button>
                </div>
                <button type="button" className="shop-add" disabled={unitPrice === null} onClick={addToCart}>
                  {unitPrice === null ? `Chọn đủ ${size} hũ` : `Thêm ${copies} set · ${vnd(unitPrice * copies)}`}
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      <section id="cach-dat" className="shop-steps">
        <div className="shop-steps-in">
          <p className="shop-kicker">Đơn giản trong 3 bước</p>
          <h2>Cách đặt hàng</h2>
          <ol>
            <li>
              <span className="shop-step-no">1</span>
              <strong>Chọn cỡ set</strong>
              <p>Set 4 hũ hoặc set 6 hũ, tuỳ nhu cầu của bạn.</p>
            </li>
            <li>
              <span className="shop-step-no">2</span>
              <strong>Chọn vị cho set</strong>
              <p>Bấm + ở từng vị đến khi đủ số hũ rồi "Thêm set". Muốn set khác thì soạn tiếp.</p>
            </li>
            <li>
              <span className="shop-step-no">3</span>
              <strong>{store.phone ? 'Gửi đơn qua Zalo' : 'Gửi đơn cho quán'}</strong>
              <p>{store.phone ? 'Điền thông tin nhận hàng, nội dung đơn được soạn sẵn, bạn chỉ cần dán vào khung chat và gửi.' : 'Điền thông tin nhận hàng rồi sao chép nội dung đơn gửi cho quán để đặt trước.'}</p>
            </li>
          </ol>
        </div>
      </section>

      <footer id="lien-he" className="shop-footer">
        <div className="shop-footer-in">
          <div className="shop-footer-brand">
            <img src="/shop/hogi-mark.svg" alt="" width={44} height={44} />
            <div>
              <strong>{store.name}</strong>
              <p>Cảm ơn bạn đã ủng hộ 🌿</p>
            </div>
          </div>
          {store.phone && (
            <div className="shop-footer-links">
              <a className="shop-footer-btn" href={telLink(store.phone)}>
                Gọi {store.phone}
              </a>
              <a className="shop-footer-btn" href={zaloLink(store.phone)} target="_blank" rel="noopener noreferrer">
                Nhắn Zalo
              </a>
            </div>
          )}
        </div>
      </footer>

      {sets > 0 && !open && (
        <button type="button" className="shop-cartbar" onClick={() => setOpen(true)}>
          <span>
            Đơn đặt trước · {sets} set ({cartJars(cart)} hũ)
          </span>
          <strong>{vnd(total)} · Xem đơn</strong>
        </button>
      )}

      {open && (
        <div className="shop-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="shop-modal" role="dialog" aria-modal="true" aria-label="Đơn đặt trước của bạn" onClick={(e) => e.stopPropagation()}>
            <div className="shop-modal-head">
              <h3>Đơn đặt trước của bạn 🥣</h3>
              <button type="button" aria-label="Đóng" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="shop-state">Chưa có set nào trong đơn. Chọn set rồi quay lại đây nhé!</p>
            ) : (
              <>
                <ul className="shop-lines">
                  {cart.map((l) => (
                    <li key={l.key}>
                      <SetThumbs mix={l.mix} items={items} />
                      <div className="shop-line-info">
                        <strong>Set {l.size} hũ</strong>
                        <small>{mixLabel(l.mix, items)}</small>
                        <small>{vnd(l.unitPrice)} / set</small>
                      </div>
                      <div className="shop-qty">
                        <button type="button" aria-label={l.qty <= 1 ? 'Xoá set' : 'Giảm'} onClick={() => setCart((c) => setLineQty(c, l.key, l.qty - 1))}>
                          {l.qty <= 1 ? (
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                            </svg>
                          ) : (
                            '−'
                          )}
                        </button>
                        <span>{l.qty}</span>
                        <button type="button" aria-label="Tăng" onClick={() => setCart((c) => setLineQty(c, l.key, l.qty + 1))}>
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="shop-total">
                  <span>Tổng thanh toán · {cartJars(cart)} hũ</span>
                  <strong>{vnd(total)}</strong>
                </div>

                <h4 className="shop-modal-title">📋 Thông tin nhận hàng</h4>
                <label className="shop-field">
                  <input type="text" value={customer.name} onChange={(e) => setField({ name: e.target.value })} placeholder="Tên của bạn *" autoComplete="name" />
                  {err('name')}
                </label>
                <label className="shop-field">
                  <input type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setField({ phone: e.target.value })} placeholder="Số điện thoại *" autoComplete="tel" />
                  {err('phone')}
                </label>
                <label className="shop-field">
                  <input type="text" value={customer.address} onChange={(e) => setField({ address: e.target.value })} placeholder="Địa chỉ / Số tầng *" autoComplete="street-address" />
                  {err('address')}
                </label>
                <label className="shop-field">
                  <textarea value={customer.note} onChange={(e) => setField({ note: e.target.value })} placeholder="Ghi chú đơn hàng (ngày giờ nhận, yêu cầu thêm…)" rows={2} />
                </label>

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
                          <dd>
                            {payAccount}{' '}
                            <button type="button" className="shop-mini" onClick={() => copyAccount(payAccount)}>
                              {accountCopied ? 'Đã chép ✓' : 'Sao chép'}
                            </button>
                          </dd>
                        </>
                      )}
                      <dt>Số tiền</dt>
                      <dd className="shop-bank-amount">{vnd(total)}</dd>
                      <dt>Nội dung</dt>
                      <dd>{memo}</dd>
                    </dl>
                    <small className="shop-hint">Mã QR đã có sẵn số tiền và mã đơn. Mở MoMo hoặc ứng dụng ngân hàng để quét.</small>
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
                      <dd>
                        {bank.account}{' '}
                        <button type="button" className="shop-mini" onClick={() => copyAccount(bank.account)}>
                          {accountCopied ? 'Đã chép ✓' : 'Sao chép'}
                        </button>
                      </dd>
                      <dt>Chủ tài khoản</dt>
                      <dd>{bank.holder}</dd>
                      <dt>Số tiền</dt>
                      <dd className="shop-bank-amount">{vnd(total)}</dd>
                      <dt>Nội dung</dt>
                      <dd>{memo}</dd>
                    </dl>
                  </div>
                )}

                {store.phone ? (
                  <button type="button" className="shop-send" onClick={sendZalo}>
                    Gửi đơn qua Zalo
                  </button>
                ) : null}
                <button type="button" className={store.phone ? 'shop-copy' : 'shop-send'} onClick={copy}>
                  {copied ? 'Đã sao chép ✓' : 'Sao chép đơn hàng'}
                </button>
                <button type="button" className="shop-copy shop-download" onClick={saveInvoice} disabled={downloading}>
                  {downloading ? 'Đang tạo hoá đơn…' : '⬇ Tải hoá đơn về máy'}
                </button>
                {tried && !ready && <small className="shop-error">Bạn điền đủ tên, số điện thoại và địa chỉ giúp quán nhé.</small>}
                <small className="shop-hint">
                  {store.phone
                    ? 'Bấm "Gửi đơn qua Zalo": nội dung đơn được sao chép sẵn, bạn chỉ cần dán vào khung chat.'
                    : 'Sao chép đơn rồi gửi cho cửa hàng để đặt trước.'}
                </small>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
