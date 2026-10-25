import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { preorderAlert } from '../lib/preorders'
import type { Preorder } from '../types/database'

// Tiếng "ting" ngắn khi có đơn mới (không cần file âm thanh)
function chime() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    // Trình duyệt chặn âm thanh khi chưa tương tác: bỏ qua
  }
}

// Nghe đơn đặt trước mới (Supabase Realtime) ở mọi trang của app quản trị: hiện thông báo trong app,
// thông báo của trình duyệt (nếu đã cho phép) và phát tiếng ting. Chỉ admin đọc được bảng preorders (RLS).
export function PreorderNotifier() {
  const toast = useToast()
  useEffect(() => {
    const channel = supabase
      .channel('preorders-new')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'preorders' }, (payload) => {
        const order = payload.new as Preorder
        const text = preorderAlert(order)
        toast.success(text)
        chime()
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Hogi · Đơn đặt trước mới', { body: text, tag: order.code })
        }
        window.dispatchEvent(new CustomEvent('preorder:new'))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [toast])
  return null
}
