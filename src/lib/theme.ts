import { useState } from 'react'
import { flushSync } from 'react-dom'
import '../lucian/u219-theme.css'
import { revealTheme } from './themeReveal'

// Chế độ sáng / tối theo từng người dùng (lưu ở trình duyệt). 'system' = theo máy.
export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'web-nhap-lieu.theme'

function readMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

// Gắn data-theme lên <html>; CSS đọc thuộc tính này (index.html cũng làm trước khi React chạy)
function applyMode(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'system') delete root.dataset.theme
  else root.dataset.theme = mode
}

// Giao diện thực sự đang hiện là tối không ('system' thì hỏi máy)
const looksDark = (mode: ThemeMode) =>
  mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode)

  // origin: nút vừa bấm, để màn mới lan ra thành vòng tròn từ nút đó (Lucian #219, src/lib/themeReveal.ts)
  const change = (next: ThemeMode, origin?: HTMLElement) => {
    const apply = () => {
      flushSync(() => setMode(next))
      applyMode(next)
    }
    if (origin && looksDark(next) !== looksDark(mode)) revealTheme(origin, looksDark(next), apply)
    else apply()
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Không lưu được thì chỉ áp dụng cho lần mở này
    }
  }

  return { mode, change }
}
