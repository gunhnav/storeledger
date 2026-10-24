// Vẽ hoá đơn bán sữa chua thành ảnh PNG (canvas) để khách tải về máy hoặc gửi cho quán. Chỉ chạy trên trình duyệt.

export type InvoiceLine = { title: string; detail: string; qty: number; unitPrice: number }
export type InvoiceData = {
  storeName: string
  storePhone: string | null
  storeDomain?: string | null
  code: string
  issuedAt: Date
  customer: { name: string; domain: string; floor: string }
  lines: InvoiceLine[]
  total: number
  paymentText: string
  // Thông tin chuyển khoản (có thì in kèm mã QR)
  qr: { dataUrl: string; holder: string; label: string; account: string; memo: string } | null
}

const GREEN = '#256b40'
const INK = '#16301f'
const MUTED = '#5d6d62'
const LINE = '#e6dec9'
const FONT = '"Be Vietnam Pro", system-ui, sans-serif'
const WIDTH = 900
const PAD = 48

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
const two = (n: number) => String(n).padStart(2, '0')
export const formatIssued = (d: Date) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`

// Ngắt dòng theo độ rộng đo được; từ quá dài tự bị cắt cho vừa
export function wrapText(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (measure(next) <= maxWidth || !line) line = next
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

export async function renderInvoice(data: InvoiceData): Promise<HTMLCanvasElement> {
  await document.fonts?.load(`600 16px ${FONT}`).catch(() => undefined)
  const [logo, qr] = await Promise.all([loadImage('/shop/hogi-mark.svg'), data.qr ? loadImage(data.qr.dataUrl) : Promise.resolve(null)])

  const canvas = document.createElement('canvas')
  const probe = canvas.getContext('2d')!
  const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`
  const measure = (size: number, weight: number) => (t: string) => {
    probe.font = font(size, weight)
    return probe.measureText(t).width
  }

  // Cột bảng: sản phẩm | SL | đơn giá | thành tiền
  const colQty = WIDTH - PAD - 330
  const colPrice = WIDTH - PAD - 170
  const colTotal = WIDTH - PAD
  const titleWidth = colQty - PAD - 40

  const info: [string, string][] = [
    ['Mã hoá đơn', data.code],
    ['Ngày lập', formatIssued(data.issuedAt)],
    ['Khách hàng', data.customer.name],
    ['Domain', data.customer.domain.trim().toLowerCase()],
    ['Tầng', data.customer.floor.trim()],
  ]
  const infoRows = info.map(([k, v]) => ({ k, lines: wrapText(measure(18, 600), v, WIDTH - PAD * 2 - 190) }))
  const lineRows = data.lines.map((l) => ({ l, title: wrapText(measure(18, 700), l.title, titleWidth), detail: wrapText(measure(15, 400), l.detail, titleWidth) }))

  // Tính chiều cao trước khi vẽ
  let y = 150
  const infoHeight = infoRows.reduce((s, r) => s + r.lines.length * 28 + 6, 0)
  const tableHeight = 44 + lineRows.reduce((s, r) => s + (r.title.length * 24 + r.detail.length * 20 + 22), 0)
  const qrBlock = qr && data.qr ? 360 : 0
  const height = y + infoHeight + 24 + tableHeight + 90 + 70 + qrBlock + 120
  canvas.width = WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.textBaseline = 'alphabetic'

  const text = (t: string, x: number, yy: number, size: number, weight: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = font(size, weight)
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(t, x, yy)
  }

  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, 0, WIDTH, height)
  // Đầu hoá đơn
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, WIDTH, 112)
  if (logo) ctx.drawImage(logo, PAD, 22, 68, 68)
  text(data.storeName, PAD + 86, 58, 30, 700, '#f7f3ea')
  text('HOÁ ĐƠN BÁN HÀNG · ĐẶT TRƯỚC', PAD + 86, 90, 15, 600, '#bfe3c6')
  if (data.storePhone) text(data.storePhone, WIDTH - PAD, 58, 18, 600, '#f7f3ea', 'right')
  if (data.storeDomain) text(`Domain: ${data.storeDomain}`, WIDTH - PAD, 88, 15, 600, '#bfe3c6', 'right')

  // Thông tin chung
  for (const r of infoRows) {
    text(r.k, PAD, y, 16, 400, MUTED)
    r.lines.forEach((ln, i) => text(ln, PAD + 190, y + i * 28, 18, 600, INK))
    y += r.lines.length * 28 + 6
  }
  y += 24

  // Bảng sản phẩm
  ctx.fillStyle = '#eaf3e6'
  ctx.fillRect(PAD - 12, y - 24, WIDTH - PAD * 2 + 24, 38)
  text('Sản phẩm', PAD, y, 15, 700, GREEN)
  text('SL', colQty, y, 15, 700, GREEN, 'right')
  text('Đơn giá', colPrice, y, 15, 700, GREEN, 'right')
  text('Thành tiền', colTotal, y, 15, 700, GREEN, 'right')
  y += 38
  for (const r of lineRows) {
    const top = y
    r.title.forEach((ln, i) => text(ln, PAD, y + i * 24, 18, 700, INK))
    y += r.title.length * 24
    r.detail.forEach((ln, i) => text(ln, PAD, y + i * 20, 15, 400, MUTED))
    y += r.detail.length * 20
    text(String(r.l.qty), colQty, top, 18, 600, INK, 'right')
    text(vnd(r.l.unitPrice), colPrice, top, 17, 400, INK, 'right')
    text(vnd(r.l.unitPrice * r.l.qty), colTotal, top, 18, 700, INK, 'right')
    y += 10
    ctx.fillStyle = LINE
    ctx.fillRect(PAD, y, WIDTH - PAD * 2, 1)
    y += 22
  }

  // Tổng tiền
  ctx.fillStyle = '#e1efd9'
  ctx.beginPath()
  ctx.roundRect(PAD - 12, y, WIDTH - PAD * 2 + 24, 64, 16)
  ctx.fill()
  text('TỔNG THANH TOÁN', PAD + 6, y + 40, 18, 700, INK)
  text(vnd(data.total), WIDTH - PAD - 6, y + 42, 28, 800, GREEN, 'right')
  y += 64 + 34
  text(`Hình thức thanh toán: ${data.paymentText}`, PAD, y, 17, 600, INK)
  y += 30

  // Mã QR chuyển khoản
  if (qr && data.qr) {
    const size = 260
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#c9bfa5'
    ctx.setLineDash([6, 5])
    ctx.beginPath()
    ctx.roundRect(PAD - 12, y, WIDTH - PAD * 2 + 24, 330, 20)
    ctx.fill()
    ctx.stroke()
    ctx.setLineDash([])
    ctx.drawImage(qr, PAD + 14, y + 35, size, size)
    const x = PAD + size + 60
    text('Quét mã để thanh toán', x, y + 56, 20, 700, INK)
    const rows: [string, string][] = [['Nhận tiền', `${data.qr.holder}`], ['Ví / ngân hàng', data.qr.label], ['Tài khoản', data.qr.account], ['Số tiền', vnd(data.total)], ['Nội dung', data.qr.memo]]
    rows.forEach(([k, v], i) => {
      text(k, x, y + 96 + i * 48, 15, 400, MUTED)
      text(v, x, y + 120 + i * 48, 18, 700, k === 'Số tiền' ? GREEN : INK)
    })
    y += 360
  }

  text('Cảm ơn bạn đã ủng hộ 🌿', WIDTH / 2, y + 30, 18, 600, MUTED, 'center')
  return canvas
}

// Tạo ảnh hoá đơn và tải về máy
export async function downloadInvoice(data: InvoiceData): Promise<void> {
  const canvas = await renderInvoice(data)
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Không tạo được ảnh hoá đơn')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `HoaDon-${data.code}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
