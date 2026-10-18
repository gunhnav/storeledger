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
  { code: 'ko', label: '한국어', short: 'KO', locale: 'ko-KR' },
  { code: 'zh', label: '中文', short: '中', locale: 'zh-CN' },
  { code: 'ja', label: '日本語', short: '日', locale: 'ja-JP' },
]

const DICTIONARIES: Record<Exclude<Lang, 'vi'>, Record<string, string>> = { en, ko, zh, ja }

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const text = lang === 'vi' ? key : (DICTIONARIES[lang][key] ?? key)
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export type I18nState = { lang: Lang; setLang: (lang: Lang) => void; t: Translate }

export const I18nContext = createContext<I18nState | null>(null)

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n phải dùng bên trong <I18nProvider>')
  return ctx
}
