const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })

const plainNumber = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

// Số tiền không kèm ký hiệu ₫ (dùng khi tiêu đề cột đã ghi đơn vị)
export function formatAmount(value: number): string {
  return plainNumber.format(value)
}

export function formatVND(value: number): string {
  return vnd.format(value)
}

// Ngày hôm nay theo giờ Việt Nam, dạng 'YYYY-MM-DD' (khớp mặc định trong DB)
export function todayVN(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
}

// Lấy thông báo lỗi đọc được từ lỗi Supabase / PostgREST
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Đã có lỗi xảy ra'
}

// 'YYYY-MM-DD' → 'dd/mm/yyyy'
export function formatDate(iso: string): string {
  return iso.split('-').reverse().join('/')
}

// Bỏ dấu tiếng Việt + chữ thường, để tìm "bun dau" ra "Bún đậu"
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

// Giới hạn chặn gõ nhầm (DB cũng kiểm tra cùng mức)
export const MAX_QTY = 10000
export const MAX_MONEY = 1_000_000_000

// Ngày giao dịch không được ở tương lai (so với giờ Việt Nam)
export function notFuture(date: string): true | string {
  return date <= todayVN() || 'Không chọn ngày trong tương lai'
}

// Ngày tháng: làm việc trên chuỗi 'YYYY-MM-DD' theo UTC để không lệch múi giờ
function toISO(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m - 1, d]
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso)
  return toISO(Date.UTC(y, m, d + days))
}

// Ngày đầu / cuối tháng, lệch `offset` tháng so với tháng chứa `iso`
export function monthStart(iso: string, offset = 0): string {
  const [y, m] = parts(iso)
  return toISO(Date.UTC(y, m + offset, 1))
}

export function monthEnd(iso: string, offset = 0): string {
  const [y, m] = parts(iso)
  return toISO(Date.UTC(y, m + offset + 1, 0))
}

const compact = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

// Số tiền rút gọn: tiếng Việt 1,2tr · 350k · 2,5 tỷ; ngôn ngữ khác theo chuẩn của locale (1.2M, 120万…)
export function formatCompact(value: number, locale = 'vi-VN'): string {
  if (locale !== 'vi-VN') {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  }
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${compact.format(value / 1e9)} tỷ`
  if (abs >= 1e6) return `${compact.format(value / 1e6)}tr`
  if (abs >= 1e3) return `${compact.format(value / 1e3)}k`
  return compact.format(value)
}

// Viết hoa chữ cái đầu tiên (bỏ qua khoảng trắng đầu), giữ nguyên phần còn lại: "tắc tươi" → "Tắc tươi"
export function capitalizeFirst(text: string): string {
  const i = text.search(/\S/)
  if (i < 0) return text
  return text.slice(0, i) + text[i].toLocaleUpperCase('vi') + text.slice(i + 1)
}
