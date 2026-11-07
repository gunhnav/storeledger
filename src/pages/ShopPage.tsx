import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, m } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { ShopCartModal } from '../components/ShopCartModal'
import { PopNumber, ShopMotion } from '../components/ShopMotion'
import { SOFT_SPRING, SPRING } from '../lib/shopMotion'
import {
  SET_SIZES,
  addSet,
  cartCount,
  cartSummary,
  cartTotal,
  changeMix,
  flavorColors,
  flavorEmoji,
  flavorImage,
  flavorPosition,
  flavorTitle,
  getCachedMenu,
  setCachedMenu,
  isSingle,
  flavorNote,
  lineOf,
  menuLines,
  mixCount,
  mixLabel,
  refreshCart,
  selectable,
  setLineQty,
  setPrice,
  setPriceHints,
  setSingleQty,
  singleQty,
  unitOf,
  GOOGLE_CHAT_URL,
  hangoutEmail,
  telLink,
  type Mix,
  type PublicMenu,
  type CartLine,
  type SetSize,
} from '../lib/storefront'

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
const REFRESH_MS = 60_000

function ShopLoading() {
  const [percent, setPercent] = useState(24)
  const [phase, setPhase] = useState('Đang kết nối tới Hogi Food…')

  useEffect(() => {
    const t1 = setTimeout(() => {
      setPercent(52)
      setPhase('Đang tải danh sách sữa chua & bánh flan…')
    }, 180)
    const t2 = setTimeout(() => {
      setPercent(78)
      setPhase('Đang chuẩn bị bảng giá & ưu đãi set…')
    }, 450)
    const t3 = setTimeout(() => {
      setPercent(92)
      setPhase('Sắp hoàn tất rồi…')
    }, 850)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  return (
    <div className="shop shop-loading-screen" role="status" aria-live="polite">
      <div className="shop-loading-card">
        <div className="shop-loading-mascot-wrap">
          <img src="/shop/hogi-logo.png" alt="" width={92} height={92} className="shop-loading-mascot" />
          <div className="shop-loading-shadow" aria-hidden="true" />
        </div>
        <h2>Đang chuẩn bị thực đơn Hogi</h2>
        <p>Sữa chua tươi ngon và bánh flan sắp sẵn sàng rồi 🥣✨</p>

        <div className="shop-progress-box">
          <div className="shop-progress-track">
            <div className="shop-progress-fill" style={{ width: `${percent}%` }}>
              <span className="shop-progress-shimmer" aria-hidden="true" />
            </div>
          </div>
          <div className="shop-progress-info">
            <span className="shop-progress-status">{phase}</span>
            <span className="shop-progress-pct">{percent}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Trang đặt trước của một quán (/hogi, /shop/<mã quán>): khách không cần đăng nhập.
// Bán theo SET 4 hoặc 6 hũ, khách tự chọn vị cho từng set (giống kênh Công ty). Không lấy tồn kho: ai đặt gì nhận đó.
// Biểu tượng nét vẽ cho 3 điểm nổi bật (thay emoji): cùng nét 1.8, 24px, màu theo chữ
const POINT_ICONS = {
  set: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 9h6v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      <path d="M13 9h6v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
      <path d="M4.5 9h7M12.5 9h7M7 6h2M15 6h2" />
    </svg>
  ),
  mix: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="5" />
      <circle cx="15" cy="9" r="5" />
      <circle cx="12" cy="14.5" r="5" />
    </svg>
  ),
  auto: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.5 12.2l2.3 2.3 4.7-5" />
    </svg>
  ),
}

// Tiếng Việt cố định vì dành cho khách của quán (không đi qua bộ dịch của app).
export function ShopPage({ code: fixedCode }: { code?: string }) {
  const params = useParams()
  const code = (fixedCode ?? params.code ?? '').toLowerCase()
  const cached = useMemo(() => (code ? getCachedMenu(code) : null), [code])
  const [menu, setMenu] = useState<PublicMenu | null | undefined>(cached ?? undefined)
  const [loading, setLoading] = useState(() => !cached)
  const [error, setError] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  // Set đang soạn: cỡ, số hũ từng vị, và số set giống hệt muốn đặt
  const [line, setLine] = useState('')
  const [size, setSize] = useState<SetSize>(4)
  const [mix, setMix] = useState<Mix>({})
  const [copies, setCopies] = useState(1)
  const [open, setOpen] = useState(false)
  const [copiedContact, setCopiedContact] = useState(false)
  // Thông báo nổi dạng chồng (Lucian #070), dùng chung với Sổ Xanh
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.rpc('get_public_menu', { p_store_code: code })
      if (e) {
        setError(true)
        return
      }
      setError(false)
      const next: PublicMenu | null = data ?? null
      setMenu(next)
      // Cập nhật giá mới và bỏ vị đã gỡ khỏi thực đơn
      if (next) {
        setCachedMenu(code, next)
        setCart((c) => refreshCart(c, next.items, next.store))
        const firstLine = menuLines(next.items)[0] ?? ''
        const firstList = next.items.filter((i) => lineOf(i) === firstLine)
        if (firstList.length === 1 && !isSingle(firstList[0])) {
          setMix({ [firstList[0].id]: 4 })
        } else {
          setMix((m) => Object.fromEntries(Object.entries(m).filter(([id]) => next.items.some((i) => i.id === id))))
        }
      }
    } finally {
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        load()
      }
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    document.title = `${menu?.store.name ?? 'Hogi Food'} – Sữa chua dẻo & bánh flan`
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.type = 'image/png'
      icon.href = '/shop/hogi-logo.png'
    }
  }, [menu])

  const items = useMemo(() => menu?.items ?? [], [menu])
  const store = menu?.store

  const lines = useMemo(() => menuLines(items), [items])
  const activeLine = lines.includes(line) ? line : (lines[0] ?? '')
  const lineItems = useMemo(() => items.filter((i) => lineOf(i) === activeLine), [items, activeLine])

  const picked = mixCount(mix)
  const unitPrice = useMemo(() => (picked === size && store ? setPrice(size, mix, items, store) : null), [picked, size, store, mix, items])

  // Giá tính sẵn cho các cỡ set: tránh gọi hàm lặp lại nhiều lần trong JSX
  const sizeHints = useMemo(() => {
    if (!store) return {} as Record<SetSize, { label: string | null; price: number }[]>
    const map = {} as Record<SetSize, { label: string | null; price: number }[]>
    for (const s of SET_SIZES) {
      map[s] = setPriceHints(s, lineItems, store)
    }
    return map
  }, [lineItems, store])

  const currentHints = sizeHints[size] ?? []
  const perJar = currentHints.length === 1 && currentHints[0].label === null

  const total = useMemo(() => cartTotal(cart), [cart])
  const count = useMemo(() => cartCount(cart), [cart])
  const summary = useMemo(() => cartSummary(cart), [cart])
  // Dòng món bán lẻ (vd: sữa chua Hy Lạp): không chọn set, mỗi món thêm thẳng vào đơn
  const singleLine = lineItems.length > 0 && lineItems.every(isSingle)

  // Khi dòng món chỉ có đúng 1 món bán theo set (vd: Bánh flan), tự động điền đủ số hũ cho set
  const autoMixFor = useCallback(
    (targetLine: string, targetSize: SetSize): Mix => {
      const list = items.filter((i) => lineOf(i) === targetLine)
      if (list.length === 1 && !isSingle(list[0])) {
        return { [list[0].id]: targetSize }
      }
      return {}
    },
    [items]
  )

  if (loading && !menu) return <ShopLoading />
  if (error && !menu) {
    return (
      <div className="shop shop-loading-screen" role="alert">
        <div className="shop-loading-card">
          <span className="shop-loading-err-icon" aria-hidden="true">🥣</span>
          <h2>Chưa tải được thực đơn</h2>
          <p>Kết nối mạng hơi chậm hoặc gián đoạn, bạn bấm thử lại nhé.</p>
          <button
            type="button"
            className="shop-cta"
            onClick={() => {
              setError(false)
              setLoading(true)
              void load()
            }}
          >
            Tải lại thực đơn
          </button>
        </div>
      </div>
    )
  }
  if (!menu || !store) {
    if (loading) return <ShopLoading />
    return (
      <div className="shop shop-loading-screen">
        <div className="shop-loading-card">
          <span className="shop-loading-err-icon" aria-hidden="true">🔍</span>
          <h2>Không tìm thấy cửa hàng</h2>
          <p>Đường dẫn có thể chưa đúng hoặc cửa hàng tạm ngưng.</p>
        </div>
      </div>
    )
  }

  const onContactHangout = () => {
    if (!store?.domain) return
    navigator.clipboard?.writeText(hangoutEmail(store.domain)).catch(() => undefined)
    toast.success(`Đã chép ${hangoutEmail(store.domain)}, dán vào Google Chat để nhắn quán`)
    setCopiedContact(true)
    setTimeout(() => setCopiedContact(false), 2500)
  }

  const chooseSize = (s: SetSize) => {
    setSize(s)
    setMix(autoMixFor(activeLine, s))
    setCopies(1)
  }
  const chooseLine = (l: string) => {
    setLine(l)
    setMix(autoMixFor(l, size))
    setCopies(1)
  }
  const addToCart = () => {
    setCart((c) => addSet(c, size, mix, copies, items, store))
    setMix(autoMixFor(activeLine, size))
    setCopies(1)
  }

  const cartIcon = (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6" />
    </svg>
  )

  return (
    <ShopMotion>
    <div className={`shop${count > 0 && !open ? ' has-cart' : ''}`} id="top">
      <header className="shop-header">
        <div className="shop-header-in">
          <a className="shop-brand" href="#top">
            <img className="shop-logo" src="/shop/hogi-logo.png" alt={store.name} width={40} height={40} />
            <strong>{store.name}</strong>
          </a>
          <nav className="shop-nav" aria-label="Điều hướng">
            <a href="#chon-set">Chọn set</a>
            <a href="#cach-dat">Cách đặt hàng</a>
            <a href="#lien-he">Liên hệ</a>
          </nav>
          <div className="shop-header-actions">
            {store.domain && (
              <a
                className="shop-contact"
                href={store.chat_url || GOOGLE_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onContactHangout}
                title={hangoutEmail(store.domain)}
              >
                {copiedContact ? 'Đã chép ' + hangoutEmail(store.domain) + ' ✓' : 'Nhắn Hangout'}
              </a>
            )}
            <button type="button" className="shop-cart-btn" aria-label={`Đơn hàng, ${count} món`} onClick={() => setOpen(true)}>
              {cartIcon}
              {count > 0 && (
                <m.span key={count} className="shop-cart-count" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={SPRING}>
                  {count}
                </m.span>
              )}
            </button>
          </div>
        </div>
      </header>

      <section className="shop-hero">
        <div className="shop-hero-in">
          <div className="shop-hero-copy">
            <h1>
              Sữa chua dẻo,
              <em>dopamine dạng hũ.</em>
            </h1>
            <p>{store.tagline || 'Chọn set 4 hoặc 6 hũ, tự mix vị bạn thích rồi đặt hàng trực tiếp tiện lợi.'}</p>
            <div className="shop-hero-cta">
              <a className="shop-cta" href="#chon-set">
                Chọn set ngay
              </a>
              <a className="shop-cta shop-cta-ghost" href="#cach-dat">
                Cách đặt hàng
              </a>
            </div>
          </div>
          <img
            className="shop-hero-art"
            src="/shop/hero.svg"
            alt="Chú hũ sữa chua Hogi cùng các vị phô mai, matcha, ca cao, nếp cẩm"
            width={640}
            height={420}
          />
        </div>
      </section>

      <ul className="shop-points">
        <li>
          <span aria-hidden="true">{POINT_ICONS.set}</span>
          <div>
            <strong>Set 4 hoặc 6 hũ</strong>
            <small>Đặt theo set, nhiều set cũng được</small>
          </div>
        </li>
        <li>
          <span aria-hidden="true">{POINT_ICONS.mix}</span>
          <div>
            <strong>Tự chọn vị</strong>
            <small>Mix đa dạng vị trong một set</small>
          </div>
        </li>
        <li>
          <span aria-hidden="true">{POINT_ICONS.auto}</span>
          <div>
            <strong>Tự động nhận đơn</strong>
            <small>Chỉ cần đặt và thanh toán, nhắn hangout khi cần hỗ trợ</small>
          </div>
        </li>
      </ul>

      <main id="chon-set" className="shop-menu">
        <div className="shop-menu-head">
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
                  <m.button key={l} type="button" role="tab" aria-selected={activeLine === l} className={activeLine === l ? 'active' : undefined} whileTap={{ scale: 0.95 }} transition={SPRING} onClick={() => chooseLine(l)}>
                    {l}
                  </m.button>
                ))}
              </div>
            )}

            {singleLine && <p className="shop-sub">Bán lẻ theo từng phần, không cần chọn set. Bấm + để thêm vào đơn.</p>}

            {!singleLine && (
            <div className="shop-sizes" role="radiogroup" aria-label="Cỡ set">
              {SET_SIZES.map((s) => {
                const h = sizeHints[s] ?? []
                return (
                  <m.button key={s} type="button" role="radio" aria-checked={size === s} className={`shop-size${size === s ? ' active' : ''}`} whileTap={{ scale: 0.97 }} transition={SPRING} onClick={() => chooseSize(s)}>
                    <strong>Set {s} hũ</strong>
                    {h.length === 0 ? (
                      <span>Giá cộng theo từng hũ</span>
                    ) : (
                      h.map((hint) => (
                        <span key={hint.label ?? 'all'}>
                          {hint.label ? `${hint.label}: ` : ''}
                          <b>{vnd(hint.price)}</b>
                        </span>
                      ))
                    )}
                  </m.button>
                )
              })}
            </div>
            )}

            <div className="shop-grid">
              {lineItems.map((item) => {
                const [c1, c2] = flavorColors(item.name)
                const image = flavorImage(item.name)
                const note = flavorNote(item.name)
                const single = isSingle(item)
                const n = single ? singleQty(cart, item.id) : (mix[item.id] ?? 0)
                const ok = single ? item.price !== null : selectable(item, size, store)
                return (
                  <div key={item.id} className="shop-card-wrap">
                  <article className={`shop-card${n > 0 ? ' is-picked' : ''}${ok ? '' : ' is-out'}`}>
                    <div className="shop-art" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} aria-hidden="true">
                      {image ? <img src={image} alt="" loading="lazy" width={520} height={430} style={{ objectPosition: flavorPosition(item.name) }} /> : <span>{flavorEmoji(item.name)}</span>}
                      <AnimatePresence>
                        {n > 0 && (
                          <m.span key="picked" className="shop-picked" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING}>
                            {n}
                          </m.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="shop-body">
                      <div className="shop-title">
                        <h3>{flavorTitle(item.name)}</h3>
                        {note && <p className="shop-note">{note}</p>}
                      </div>
                      {(single || perJar) && item.price !== null && (
                        <p className="shop-price">
                          {vnd(item.price)}
                          <small> / {unitOf(item.name)}</small>
                        </p>
                      )}
                      {ok && single ? (
                        <div className="shop-qty" role="group" aria-label={`Số lượng ${item.name}`}>
                          <m.button type="button" aria-label={`Bớt ${item.name}`} disabled={n === 0} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCart((c) => setSingleQty(c, item, n - 1))}>
                            −
                          </m.button>
                          <PopNumber value={n} />
                          <m.button type="button" aria-label={`Thêm ${item.name}`} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCart((c) => setSingleQty(c, item, n + 1))}>
                            +
                          </m.button>
                        </div>
                      ) : ok ? (
                        <div className="shop-qty" role="group" aria-label={`Số hũ ${item.name}`}>
                          <m.button type="button" aria-label={`Bớt ${item.name}`} disabled={n === 0} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setMix((mx) => changeMix(mx, item.id, -1, size))}>
                            −
                          </m.button>
                          <PopNumber value={n} />
                          <m.button type="button" aria-label={`Thêm ${item.name}`} disabled={picked >= size} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setMix((mx) => changeMix(mx, item.id, 1, size))}>
                            +
                          </m.button>
                        </div>
                      ) : (
                        <p className="shop-note">Chưa có giá</p>
                      )}
                    </div>
                  </article>
                  </div>
                )
              })}
            </div>

            {!singleLine && (
            <div className={`shop-builder${count > 0 ? ' has-cartbar' : ''}`} aria-live="polite">
              <div className="shop-builder-info">
                <div className={`shop-dots shop-dots-${size}`} aria-hidden="true">
                  {Array.from({ length: size }, (_, i) => (
                    <m.span key={i} className={i < picked ? 'on' : undefined} animate={{ scale: i < picked ? 1 : 0.85 }} transition={SPRING} />
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
                  <m.button type="button" aria-label="Giảm số set" disabled={copies <= 1} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCopies((c) => Math.max(1, c - 1))}>
                    −
                  </m.button>
                  <PopNumber value={copies} />
                  <m.button type="button" aria-label="Tăng số set" whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCopies((c) => Math.min(99, c + 1))}>
                    +
                  </m.button>
                </div>
                <m.button type="button" className="shop-add" disabled={unitPrice === null} whileTap={unitPrice === null ? undefined : { scale: 0.97 }} transition={SPRING} onClick={addToCart}>
                  {unitPrice === null ? `Chọn đủ ${size} hũ` : `Thêm ${copies} set · ${vnd(unitPrice * copies)}`}
                </m.button>
              </div>
            </div>
            )}
          </>
        )}
      </main>

      <section id="cach-dat" className="shop-steps">
        <div className="shop-steps-in">
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
              <strong>Đặt hàng & Nhận hàng</strong>
              <p>Điền domain và tầng nhận hàng. Quán sẽ tự động nhận trạng thái của đơn khi bạn đặt hàng và chuyển khoản. Nếu cần tư vấn gì thêm, bạn có thể bấm "Nhắn Hangout".</p>
            </li>
          </ol>
        </div>
      </section>

      <footer id="lien-he" className="shop-footer">
        <div className="shop-footer-in">
          <div className="shop-footer-brand">
            <img className="shop-logo" src="/shop/hogi-logo.png" alt="" width={44} height={44} />
            <div>
              <strong>{store.name}</strong>
              <p>Cảm ơn bạn đã ủng hộ 🌿</p>
            </div>
          </div>
          {(store.phone || store.domain) && (
            <div className="shop-footer-links">
              {store.phone && (
                <a className="shop-footer-btn" href={telLink(store.phone)}>
                  Gọi {store.phone}
                </a>
              )}
              {store.domain && (
                <a
                  className="shop-footer-btn"
                  href={store.chat_url || GOOGLE_CHAT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onContactHangout}
                >
                  {copiedContact ? 'Đã chép ' + hangoutEmail(store.domain) + ' ✓' : `Nhắn Hangout ${hangoutEmail(store.domain)}`}
                </a>
              )}
            </div>
          )}
        </div>
      </footer>

      <AnimatePresence>
        {count > 0 && !open && (
          <m.button
            key="cartbar"
            type="button"
            className="shop-cartbar"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            whileTap={{ scale: 0.98 }}
            transition={SOFT_SPRING}
            onClick={() => setOpen(true)}
          >
            <span>
              Đơn đặt trước · {summary}
            </span>
            <strong>{vnd(total)} · Xem đơn</strong>
          </m.button>
        )}
      </AnimatePresence>

      <ShopCartModal
        open={open}
        onClose={() => setOpen(false)}
        cart={cart}
        items={items}
        store={store}
        onSetLineQty={(k, q) => setCart((c) => setLineQty(c, k, q))}
        storeCode={code}
        onPlaced={() => setCart([])}
      />
    </div>
    </ShopMotion>
  )
}
