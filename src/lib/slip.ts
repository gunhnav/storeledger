// Slip Node (https://github.com/lucian-labs/slip-node, CC0): chuyển trang giữa hai website khác domain mà màn hình không nháy trắng.
// Trang rời phủ kín một màu rồi mới chuyển, truyền màu đó qua URL (?slip=1&slipbg=<màu>); trang đến chạy đoạn script inline
// trong <head> của index.html: tô nền bằng màu đó, ẩn nội dung trước lần vẽ đầu; app gọi liftSlip() để mở dần nội dung.
// Dùng chung cho Sổ Xanh và Hogi Food: cùng một bản build (dist/shop.html sinh từ index.html, xem scripts/generate-shop-html.mjs).

// Mẫu màu hợp lệ theo đặc tả: tham số đến từ domain khác, có thể bị giả mạo, nên chỉ nhận màu dạng chữ thuần
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([0-9 .,%]+\))$/i
const PARAMS = ['slip', 'slipbg', 'slipx', 'slipy']
const FALLBACK = '#000'
const COVER_STYLE = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;'

// Thời gian phủ màu khi rời trang và mở màu khi đến (ms)
export const SLIP_OUT_MS = 320
export const SLIP_IN_MS = 420

export const isSlipColour = (value: string | null | undefined): value is string => !!value && COLOUR.test(value)

// URL đích có gắn tham số slip (giữ nguyên query và hash sẵn có)
export function withSlip(url: string, colour: string, base?: string): string {
  const u = new URL(url, base)
  u.searchParams.set('slip', '1')
  u.searchParams.set('slipbg', isSlipColour(colour) ? colour : FALLBACK)
  return u.toString()
}

// Màu đến từ query (null nếu không phải lượt slip); màu sai mẫu thì về màu dự phòng như đoạn script inline
export function readSlip(search: string): string | null {
  const q = new URLSearchParams(search)
  if (q.get('slip') !== '1') return null
  const bg = q.get('slipbg')
  return isSlipColour(bg) ? bg : FALLBACK
}

// Đường dẫn (path + query + hash) đã bỏ các tham số slip, để tải lại trang không phát lại hiệu ứng
export function stripSlip(href: string): string {
  const u = new URL(href)
  for (const key of PARAMS) u.searchParams.delete(key)
  return u.pathname + u.search + u.hash
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Màu nền đang hiển thị của trang (trang cửa hàng .shop có nền riêng), dùng làm màu phủ khi rời trang
export function pageColour(): string {
  for (const el of [document.querySelector('.shop'), document.body, document.documentElement]) {
    if (!el) continue
    const bg = getComputedStyle(el).backgroundColor
    if (isSlipColour(bg) && !/^rgba\([^)]*,\s*0\)$/.test(bg) && bg !== 'transparent') return bg
  }
  return '#256b40'
}

// Rời trang sang website khác (cùng tab): phủ màu, chờ phủ kín rồi mới chuyển
export function slipTo(url: string, colour: string = pageColour()): void {
  const target = withSlip(url, colour, window.location.href)
  const cover = document.createElement('div')
  cover.style.cssText = COVER_STYLE + `background:${isSlipColour(colour) ? colour : FALLBACK}`
  document.body.appendChild(cover)
  if (reducedMotion() || typeof cover.animate !== 'function') {
    window.location.href = target
    return
  }
  cover
    .animate([{ opacity: 0 }, { opacity: 1 }], { duration: SLIP_OUT_MS, easing: 'ease-in', fill: 'forwards' })
    .finished.then(() => {
      window.location.href = target
    })
}

// Gọi trước khi React render: nhận màu của lượt slip và dọn tham số khỏi thanh địa chỉ (giữ history.state của router)
export function takeSlipArrival(): string | null {
  const colour = readSlip(window.location.search)
  if (colour === null) return null
  try {
    window.history.replaceState(window.history.state, '', stripSlip(window.location.href))
  } catch {
    // Không dọn được URL thì thôi, hiệu ứng vẫn chạy
  }
  return colour
}

// Gọi sau khi React render: mở nội dung dưới một lớp phủ cùng màu rồi làm mờ dần lớp phủ.
// Nếu đoạn script inline đã tự gỡ (quá 2,5 giây) thì không làm gì.
export function liftSlip(colour: string): void {
  const root = document.documentElement
  if (!root.hasAttribute('data-slip-arriving')) return
  const lift = () => {
    if (!root.hasAttribute('data-slip-arriving')) return
    const animated = !reducedMotion() && typeof HTMLElement.prototype.animate === 'function'
    const cover = animated ? document.createElement('div') : null
    if (cover) {
      cover.style.cssText = COVER_STYLE + `background:${colour}`
      document.body.appendChild(cover)
    }
    root.removeAttribute('data-slip-arriving')
    root.style.removeProperty('background')
    if (!cover) return
    cover
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: SLIP_IN_MS, easing: 'ease-out', fill: 'forwards' })
      .finished.finally(() => cover.remove())
  }
  // Chờ hai khung hình để nội dung đầu tiên của React đã được vẽ dưới lớp phủ
  requestAnimationFrame(() => requestAnimationFrame(lift))
}
