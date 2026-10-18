import { createContext, useContext } from 'react'

// Thông báo nổi (toast): tự tắt sau vài giây. Dùng cho thông báo lưu thành công.
export type ToastKind = 'success' | 'error'
export type ToastApi = { success: (text: string) => void; error: (text: string) => void }

// Mặc định không làm gì (không ném lỗi khi thiếu provider, ví dụ lúc Vite nạp lại nóng)
export const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {} })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
