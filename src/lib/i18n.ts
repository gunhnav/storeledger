import { createContext, useContext } from 'react'
import { en } from '../i18n/en'
import { ja } from '../i18n/ja'
import { ko } from '../i18n/ko'
import { zh } from '../i18n/zh'

// Đa ngôn ngữ: chữ tiếng Việt trong code chính là khoá tra từ điển.
// Thiếu bản dịch thì hiện tiếng Việt. Tham số viết dạng {name}.
export type Lang = 'vi' | 'en' | 'ko' | 'zh' | 'ja'

export const LANGUAGES: { code: Lang; label: string; short: string; locale: string }[] = [
  { code: 'vi', label: 'Tiếng Việt', short: 'VI', locale: 'vi-VN' },
  { code: 'en', label: 'English', short: 'EN', locale: 'en-US' },
  { code: 'ko', label: '한국어', short: '한', locale: 'ko-KR' },
  { code: 'zh', label: '中文', short: '中', locale: 'zh-CN' },
  { code: 'ja', label: '日本語', short: '日', locale: 'ja-JP' },
]

const DICTIONARIES: Record<Exclude<Lang, 'vi'>, Record<string, string>> = { en, ko, zh, ja }

export type Translate = (key: string, params?: Record<string, string | number>) => string

// Thông báo lỗi do database / Edge Function trả về (tiếng Việt, có tham số).
// Nhận diện theo mẫu để dịch được cả khi đã ghép tên món, ngày, số lượng.
const SERVER_TEMPLATES = [
  'Không đủ hàng ở quầy cho "{name}" tính đến ngày {date}: hiện có {have}, cần bán {need}. Nhập hàng và chuyển ra quầy trước khi bán',
  'Không đủ hàng ở nhà cho "{name}" tính đến ngày {date}: hiện có {have}, cần chuyển {need}. Nhập hàng trước',
  'Không đủ hàng ở quầy cho "{name}": hiện có {have}, cần bán {need}',
  'Không đủ hàng ở quán cho "{name}" tính đến ngày {date}: hiện có {have}, cần bán {need}. Nhập hàng và phân phối ra quán trước khi bán',
  'Không đủ hàng đã chuyển cho công ty của "{name}" tính đến ngày {date}: hiện có {have}, cần bán {need}. Phân phối cho công ty trước khi bán',
  'Nơi nhận không hợp lệ: {value} (chỉ nhận shop hoặc company)',
  'Không đủ hàng ở nhà cho "{name}": hiện có {have}, cần chuyển {need}',
  'Không được ghi ngày trong tương lai ({date})',
  'Món "{name}" chưa có giá vào ngày {date}',
  'Món "{name}" chưa có giá vốn vào ngày {date}, cần admin nhập trước khi bán',
  'Món "{name}" chưa có giá vốn vào ngày {date}, nhập giá hoặc nhờ admin cập nhật',
  'Món "{name}" chưa có giá vốn cố định, cần admin nhập trước khi bán',
  'Món "{name}" đã ngừng bán',
  'Sản phẩm "{name}" không quản lý tồn kho, không thể chuyển hàng',
  'Sản phẩm "{name}" không quản lý tồn kho, không thể nhập hàng',
]

// Thông báo cố định từ server (để có trong từ điển)
export const SERVER_MESSAGES = [
  'Bạn cần đăng nhập',
  'Bạn không có quyền thao tác với cửa hàng này',
  'Bạn không có quyền xem cửa hàng này',
  'Chỉ admin được quản lý tài khoản',
  'Chỉ admin được xem báo cáo lãi lỗ',
  'Chỉ admin được xem danh sách nhân viên',
  'Chỉ admin được xem nhật ký ngày',
  'Chỉ admin được xem điểm hoà vốn',
  'Chỉ admin được đổi giá',
  'Email này đã có tài khoản',
  'Email này đã có tài khoản khác dùng',
  'Giá ShopeeFood không hợp lệ',
  'Giá bán không hợp lệ',
  'Giá nhập không hợp lệ',
  'Giá vốn không hợp lệ',
  'Khoảng ngày không hợp lệ',
  'Khoảng ngày tối đa 366 ngày',
  'Số lượng bán phải lớn hơn 0',
  'Số lượng bán quá lớn (tối đa 10.000)',
  'Số lượng chuyển phải lớn hơn 0',
  'Số lượng chuyển quá lớn (tối đa 10.000)',
  'Số lượng nhập phải lớn hơn 0',
  'Số lượng nhập quá lớn (tối đa 10.000)',
  'Đơn giá bán không hợp lệ',
]

const SERVER_PATTERNS = SERVER_TEMPLATES.map((template) => {
  const names: string[] = []
  const source = template
    .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{(\w+)\}/g, (_m, name: string) => {
      names.push(name)
      return '(.+?)'
    })
  return { template, names, re: new RegExp(`^${source}$`) }
})

function translateServer(lang: Exclude<Lang, 'vi'>, text: string): string | null {
  for (const { template, names, re } of SERVER_PATTERNS) {
    const match = re.exec(text)
    if (!match) continue
    const translated = DICTIONARIES[lang][template]
    if (!translated) return null
    return translated.replace(/\{(\w+)\}/g, (m, name: string) => {
      const i = names.indexOf(name)
      return i >= 0 ? match[i + 1] : m
    })
  }
  return null
}

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const text =
    lang === 'vi' ? key : (DICTIONARIES[lang][key] ?? (params ? null : translateServer(lang, key)) ?? key)
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export type I18nState = { lang: Lang; setLang: (lang: Lang) => void; t: Translate }

// Mặc định tiếng Việt: không ném lỗi khi thiếu provider (ví dụ lúc Vite nạp lại nóng
// file này tạo context mới) để không làm trắng cả màn hình
const FALLBACK: I18nState = { lang: 'vi', setLang: () => {}, t: (key, params) => translate('vi', key, params) }

export const I18nContext = createContext<I18nState>(FALLBACK)

export function useI18n(): I18nState {
  return useContext(I18nContext)
}
