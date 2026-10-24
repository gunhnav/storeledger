import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  STATUS_TEXT,
  addToCart,
  canOrder,
  cartCount,
  cartTotal,
  flavorColors,
  flavorImage,
  orderMessage,
  pruneCart,
  setCartQty,
  telLink,
  zaloLink,
  type CartLine,
  type MenuItem,
  type PublicMenu,
} from '../lib/storefront'

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
const REFRESH_MS = 60_000

// Trang bán hàng công khai của một quán (/hogi, /shop/<mã quán>): khách không cần đăng nhập.
// Thực đơn, giá và tình trạng hàng (còn / sắp hết / hết) lấy từ kho qua get_public_menu; không lộ số lượng hay giá vốn.
// Tiếng Việt cố định vì dành cho khách của quán (không đi qua bộ dịch của app).
export function ShopPage({ code: fixedCode }: { code?: string }) {
  const params = useParams()
  const code = (fixedCode ?? params.code ?? '').toLowerCase()
  const [menu, setMenu] = useState<PublicMenu | null | undefined>(undefined)
  const [error, setError] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [qty, setQty] = useState<Record<string, number>>({})
  const [open, setOpen] = useState(false)
  const [customer, setCustomer] = useState({ name: '', note: '' })
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_public_menu', { p_store_code: code })
    if (e) return setError(true)
    setError(false)
    const next: PublicMenu | null = data ?? null
    setMenu(next)
    // Món vừa hết hàng thì bỏ khỏi giỏ
    if (next) setCart((c) => pruneCart(c, next.items))
  }, [code])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (menu) document.title = `${menu.store.name} – Đặt hàng online`
  }, [menu])

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
  const groups = new Map<string, MenuItem[]>()
  for (const i of items) groups.set(i.category ?? 'Thực đơn', [...(groups.get(i.category ?? 'Thực đơn') ?? []), i])
  const total = cartTotal(cart)
  const count = cartCount(cart)
  const message = orderMessage(store.name, cart, customer)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Sao chép nội dung đơn hàng:', message)
    }
  }
  const sendZalo = async () => {
    await copy()
    if (store.phone) window.open(zaloLink(store.phone), '_blank', 'noopener')
  }

  return (
    <div className="shop">
      <header className="shop-header">
        <div className="shop-brand">
          <img className="shop-logo" src="/shop/hogi-mark.svg" alt="" width={40} height={40} />
          <strong>{store.name}</strong>
        </div>
        {store.phone && (
          <a className="shop-contact" href={zaloLink(store.phone)} target="_blank" rel="noopener noreferrer">
            Zalo / Hotline: {store.phone}
          </a>
        )}
      </header>

      <section className="shop-hero">
        <div className="shop-hero-copy">
          <span className="shop-eyebrow">Sữa chua hũ thủ công</span>
          <h1>{store.name}</h1>
          <p>{store.tagline || 'Sữa chua hũ ngon mỗi ngày. Chọn vị bạn thích và đặt hàng ngay!'}</p>
          <a className="shop-cta" href="#thuc-don">
            Xem thực đơn
          </a>
        </div>
        <img className="shop-hero-art" src="/shop/hero.svg" alt="Chú hũ sữa chua Hogi cùng các vị phô mai, matcha, ca cao, nếp cẩm" width={640} height={420} />
      </section>

      <main id="thuc-don" className="shop-menu">
        <h2>Thực đơn</h2>
        {items.length === 0 && <p className="shop-state">Thực đơn đang được cập nhật.</p>}
        {[...groups].map(([group, list]) => (
          <section key={group} className="shop-group">
            <h3>{group}</h3>
            <div className="shop-grid">
              {list.map((item) => {
                const [c1, c2] = flavorColors(item.name)
                const image = flavorImage(item.name)
                const orderable = canOrder(item)
                const q = qty[item.id] ?? 1
                return (
                  <article key={item.id} className={`shop-card${orderable ? '' : ' is-out'}`}>
                    <div className="shop-art" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} aria-hidden="true">
                      {image ? <img src={image} alt="" loading="lazy" width={520} height={430} /> : <span>🥣</span>}
                      <span className={`shop-status shop-status-${item.status}`}>{STATUS_TEXT[item.status]}</span>
                    </div>
                    <div className="shop-body">
                      <h4>{item.name}</h4>
                      <p className="shop-price">{item.price === null ? 'Liên hệ' : vnd(item.price)}</p>
                      {orderable ? (
                        <div className="shop-actions">
                          <div className="shop-qty" role="group" aria-label={`Số lượng ${item.name}`}>
                            <button type="button" aria-label="Giảm" onClick={() => setQty((s) => ({ ...s, [item.id]: Math.max(1, q - 1) }))}>
                              −
                            </button>
                            <span>{q}</span>
                            <button type="button" aria-label="Tăng" onClick={() => setQty((s) => ({ ...s, [item.id]: Math.min(99, q + 1) }))}>
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            className="shop-add"
                            onClick={() => {
                              setCart((c) => addToCart(c, item, q))
                              setQty((s) => ({ ...s, [item.id]: 1 }))
                            }}
                          >
                            Thêm vào đơn hàng
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="shop-add" disabled>
                          Tạm hết hàng
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </main>

      <footer className="shop-footer">
        <strong>{store.name}</strong>
        <p>Cảm ơn bạn đã ủng hộ 🌿</p>
        {store.phone && (
          <p>
            <a href={telLink(store.phone)}>Gọi {store.phone}</a> · <a href={zaloLink(store.phone)} target="_blank" rel="noopener noreferrer">Nhắn Zalo</a>
          </p>
        )}
      </footer>

      {count > 0 && !open && (
        <button type="button" className="shop-cartbar" onClick={() => setOpen(true)}>
          <span>
            Đơn hàng · {count} hũ
          </span>
          <strong>{vnd(total)} · Xem đơn</strong>
        </button>
      )}

      {open && (
        <div className="shop-sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="shop-sheet" role="dialog" aria-label="Đơn hàng của bạn" onClick={(e) => e.stopPropagation()}>
            <div className="shop-sheet-head">
              <h3>Đơn hàng của bạn</h3>
              <button type="button" aria-label="Đóng" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            {cart.length === 0 ? (
              <p className="shop-state">Chưa có món nào trong đơn.</p>
            ) : (
              <>
                <ul className="shop-lines">
                  {cart.map((l) => (
                    <li key={l.id}>
                      <div>
                        <strong>{l.name}</strong>
                        <small>{vnd(l.price)} / hũ</small>
                      </div>
                      <div className="shop-qty">
                        <button type="button" aria-label="Giảm" onClick={() => setCart((c) => setCartQty(c, l.id, l.qty - 1))}>
                          −
                        </button>
                        <span>{l.qty}</span>
                        <button type="button" aria-label="Tăng" onClick={() => setCart((c) => setCartQty(c, l.id, l.qty + 1))}>
                          +
                        </button>
                      </div>
                      <strong className="shop-line-total">{vnd(l.price * l.qty)}</strong>
                    </li>
                  ))}
                </ul>
                <label className="shop-field">
                  Tên của bạn
                  <input type="text" value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} placeholder="Không bắt buộc" />
                </label>
                <label className="shop-field">
                  Ghi chú
                  <input type="text" value={customer.note} onChange={(e) => setCustomer((c) => ({ ...c, note: e.target.value }))} placeholder="Giờ nhận, địa chỉ giao…" />
                </label>
                <div className="shop-total">
                  <span>Tổng cộng</span>
                  <strong>{vnd(total)}</strong>
                </div>
                {store.phone ? (
                  <button type="button" className="shop-send" onClick={sendZalo}>
                    Gửi đơn qua Zalo
                  </button>
                ) : null}
                <button type="button" className={store.phone ? 'shop-copy' : 'shop-send'} onClick={copy}>
                  {copied ? 'Đã sao chép ✓' : 'Sao chép đơn hàng'}
                </button>
                <small className="shop-hint">
                  {store.phone
                    ? 'Bấm "Gửi đơn qua Zalo": nội dung đơn được sao chép sẵn, bạn chỉ cần dán vào khung chat.'
                    : 'Sao chép đơn rồi gửi cho cửa hàng để đặt hàng.'}
                </small>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
