// Trang bán hàng công khai (/hogi, /shop/<mã quán>): giỏ hàng, nội dung đơn gửi qua Zalo, màu theo vị.

export type MenuStatus = 'in_stock' | 'low' | 'out'
export type MenuItem = { id: string; name: string; category: string | null; price: number | null; status: MenuStatus }
export type PublicMenu = { store: { name: string; phone: string | null; tagline: string | null }; items: MenuItem[] }

export type CartLine = { id: string; name: string; price: number; qty: number }

export const canOrder = (item: MenuItem) => item.status !== 'out' && item.price !== null

export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + l.price * l.qty, 0)
export const cartCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.qty, 0)

// Thêm vào giỏ: cộng dồn số lượng, tối đa 99 mỗi món
export function addToCart(lines: CartLine[], item: MenuItem, qty: number): CartLine[] {
  if (!canOrder(item) || qty <= 0) return lines
  const existing = lines.find((l) => l.id === item.id)
  if (existing) return lines.map((l) => (l.id === item.id ? { ...l, qty: Math.min(99, l.qty + qty) } : l))
  return [...lines, { id: item.id, name: item.name, price: item.price!, qty: Math.min(99, qty) }]
}

// Đặt số lượng một dòng; 0 hoặc nhỏ hơn thì bỏ dòng
export function setCartQty(lines: CartLine[], id: string, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.id !== id)
  return lines.map((l) => (l.id === id ? { ...l, qty: Math.min(99, qty) } : l))
}

// Bỏ các dòng của món đã hết hàng sau khi thực đơn được tải lại
export function pruneCart(lines: CartLine[], items: MenuItem[]): CartLine[] {
  const ok = new Set(items.filter(canOrder).map((i) => i.id))
  return lines.filter((l) => ok.has(l.id))
}

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Nội dung đơn để dán vào Zalo
export function orderMessage(storeName: string, lines: CartLine[], customer: { name?: string; note?: string } = {}): string {
  const rows = lines.map((l) => `- ${l.name} x${l.qty}: ${vnd(l.price * l.qty)}`)
  const out = [`Xin chào ${storeName}, mình muốn đặt:`, ...rows, `Tổng: ${vnd(cartTotal(lines))}`]
  if (customer.name?.trim()) out.push(`Tên: ${customer.name.trim()}`)
  if (customer.note?.trim()) out.push(`Ghi chú: ${customer.note.trim()}`)
  return out.join('\n')
}

// Số điện thoại chỉ giữ chữ số (và +) để làm link Zalo / gọi
export const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '')
export const zaloLink = (phone: string) => `https://zalo.me/${cleanPhone(phone).replace(/^\+84/, '0')}`
export const telLink = (phone: string) => `tel:${cleanPhone(phone)}`

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd')

// Màu nền thẻ món theo vị (không có ảnh sản phẩm)
export function flavorColors(name: string): [string, string] {
  const n = norm(name)
  if (n.includes('matcha')) return ['#cfe8b0', '#8fb86a']
  if (n.includes('ca cao') || n.includes('cacao') || n.includes('socola')) return ['#e6c9b3', '#a0694c']
  if (n.includes('nep cam')) return ['#e2c9e6', '#8a5a94']
  if (n.includes('pho mai')) return ['#fbe9a8', '#f0c04a']
  if (n.includes('truyen thong')) return ['#f6efd9', '#e3d2a2']
  return ['#d6ead9', '#7fb58a']
}

// Hình minh hoạ theo vị (public/shop/flavor-*.svg); vị lạ thì null và trang dùng màu nền thay thế
export function flavorImage(name: string): string | null {
  const n = norm(name)
  if (n.includes('matcha')) return '/shop/flavor-matcha.svg'
  if (n.includes('ca cao') || n.includes('cacao') || n.includes('socola')) return '/shop/flavor-ca-cao.svg'
  if (n.includes('nep cam')) return '/shop/flavor-nep-cam.svg'
  if (n.includes('pho mai')) return '/shop/flavor-pho-mai.svg'
  if (n.includes('truyen thong') || n.includes('nguyen ban')) return '/shop/flavor-truyen-thong.svg'
  return null
}

export const STATUS_TEXT: Record<MenuStatus, string> = { in_stock: 'Còn hàng', low: 'Sắp hết', out: 'Hết hàng' }
