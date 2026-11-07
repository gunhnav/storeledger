import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext, LANGUAGES, hasDictionary, loadDictionary, translate, type I18nState, type Lang } from '../lib/i18n'

const STORAGE_KEY = 'web-nhap-lieu.lang'

function readLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (LANGUAGES.some((l) => l.code === saved)) return saved as Lang
  } catch {
    // Không đọc được thì dùng tiếng Việt
  }
  return 'vi'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  // Ngôn ngữ đã tải xong từ điển; đổi giá trị để dựng lại t() sau khi tải
  const [loaded, setLoaded] = useState<Lang>(() => (hasDictionary(lang) ? lang : 'vi'))

  useEffect(() => {
    let cancelled = false
    loadDictionary(lang)
      .then(() => {
        if (!cancelled) setLoaded(lang)
      })
      .catch(() => {
        // Mất mạng khi tải bản dịch: giữ tiếng Việt, lần đổi ngôn ngữ sau thử lại
      })
    return () => {
      cancelled = true
    }
  }, [lang])

  // Gắn lang lên <html> để trình duyệt chọn font / đọc màn hình đúng ngôn ngữ
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Không lưu được thì chỉ áp dụng cho lần mở này
    }
  }, [])

  const value = useMemo<I18nState>(
    () => ({ lang, setLang, t: (key, params) => translate(loaded === lang ? lang : 'vi', key, params) }),
    [lang, loaded, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
