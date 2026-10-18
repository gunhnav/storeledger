import { LANGUAGES, useI18n, type Lang } from '../lib/i18n'
import { Icon } from './Icon'

// Chọn ngôn ngữ: Việt, Anh, Hàn, Trung, Nhật (lưu trên thiết bị).
// variant 'pills': hàng nút bấm (dùng trong menu, không có danh sách bật ra của trình duyệt)
export function LanguageSelect({ variant = 'select' }: { variant?: 'select' | 'pills' }) {
  const { lang, setLang, t } = useI18n()

  if (variant === 'pills') {
    return (
      <div className="lang-pills" role="radiogroup" aria-label={t('Ngôn ngữ')}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            className={lang === l.code ? 'active' : undefined}
            onClick={() => setLang(l.code)}
            title={l.label}
            lang={l.code}
          >
            {l.short}
          </button>
        ))}
      </div>
    )
  }

  return (
    <label className="lang-select">
      <Icon name="globe" size={16} />
      <select aria-label={t('Ngôn ngữ')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
