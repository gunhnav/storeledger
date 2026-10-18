import { LANGUAGES, useI18n, type Lang } from '../lib/i18n'
import { Icon } from './Icon'

// Chọn ngôn ngữ: Việt, Anh, Hàn, Trung, Nhật (lưu trên thiết bị)
export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n()
  return (
    <label className={`lang-select${compact ? ' compact' : ''}`}>
      <Icon name="globe" size={16} />
      <select aria-label={t('Ngôn ngữ')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {compact ? l.short : l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
