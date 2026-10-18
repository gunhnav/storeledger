const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })

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
