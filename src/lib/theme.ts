import { useState } from 'react'

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

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode)

  const change = (next: ThemeMode) => {
    setMode(next)
    applyMode(next)
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Không lưu được thì chỉ áp dụng cho lần mở này
    }
  }

  return { mode, change }
}
