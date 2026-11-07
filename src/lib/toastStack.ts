/* Lucian UX/UI Prompt #070 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#070 */
// Bộ máy chồng thông báo (Stacking toasts), chuyển từ script gốc của phần tử #070 sang TypeScript.
// Chạy trực tiếp trên DOM (giống bản gốc) để giữ nguyên chuyển động; ToastProvider gọi push() và destroy() khi gỡ.
// Khác bản gốc: chỉ 2 loại (lưu xong / lỗi) theo app, giữ tối đa MAX cái, vòng requestAnimationFrame chỉ chạy khi còn thông báo,
// vùng chứa cao đúng bằng chồng thông báo (khung cố định trên màn hình thay cho ô demo).

export type StackKind = 'success' | 'error'
export type ToastStack = { push: (kind: StackKind, text: string) => void; destroy: () => void }

type Item = { el: HTMLDivElement; left: number }

const DUR = 4500
const MAX = 5
const GAP = 8
const COLOUR: Record<StackKind, string> = { success: 'var(--ux-mint)', error: 'var(--ux-danger)' }
const ICON: Record<StackKind, string> = {
  success: '<svg viewBox="0 0 18 18"><path d="M4 9.4l3.2 3.2L14 5.6"/></svg>',
  error: '<svg viewBox="0 0 18 18"><path d="M9 5v5M9 13h.01"/></svg>',
}
const CLOSE = '<svg viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>'

export function createToastStack(zone: HTMLElement, live: HTMLElement, closeLabel: () => string): ToastStack {
  let list: Item[] = []
  let open = false
  let raf = 0
  let last = 0
  const timers = new Set<number>()

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  function layout() {
    let acc = 0
    list.forEach((t, i) => {
      const el = t.el
      el.classList.toggle('back', !open && i > 0)
      if (open) {
        el.style.setProperty('--y', -acc + 'px')
        el.style.setProperty('--s', '1')
        el.style.setProperty('--o', '1')
        acc += el.offsetHeight + GAP
      } else {
        el.style.setProperty('--y', -(i * 14) + 'px')
        el.style.setProperty('--s', (1 - i * 0.06).toFixed(2))
        el.style.setProperty('--o', i > 2 ? '0' : '1')
      }
      el.style.zIndex = String(50 - i)
      el.inert = !open && i > 0
    })
    // Vùng nhận rê chuột phủ đúng chồng thông báo (cả khe giữa các thẻ khi xoè), không che phần còn lại của trang
    const front = list[0]?.el.offsetHeight ?? 0
    zone.style.height = (open ? Math.max(0, acc - GAP) : list.length ? front + Math.min(list.length - 1, 2) * 14 : 0) + 'px'
  }

  function remove(t: Item, dir?: number) {
    const i = list.indexOf(t)
    if (i < 0) return
    list.splice(i, 1)
    t.el.classList.add('leave')
    if (dir) {
      t.el.style.setProperty('--dir', String(dir))
      t.el.classList.add('side')
    }
    later(() => t.el.remove(), 450)
    if (!list.length) open = false
    layout()
  }

  // Chỉ thông báo trước nhất đếm giờ; dừng khi đang xoè
  function tick(now: number) {
    raf = 0
    if (!zone.isConnected) return
    const dt = now - last
    last = now
    const front = list[0]
    if (!open && front) {
      front.left -= dt
      front.el.style.setProperty('--left', Math.max(0, front.left / DUR).toFixed(3))
      if (front.left <= 0) remove(front)
    }
    if (list.length) raf = requestAnimationFrame(tick)
  }
  const run = () => {
    if (raf) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function push(kind: StackKind, text: string) {
    const el = document.createElement('div')
    el.className = 'u070-t enter'
    el.style.setProperty('--c', COLOUR[kind])
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    el.innerHTML =
      '<span class="u070-ic" aria-hidden="true">' +
      ICON[kind] +
      '</span><span class="u070-tx"><b></b></span><button class="u070-x" type="button">' +
      CLOSE +
      '</button><span class="u070-bar" aria-hidden="true"></span>'
    el.querySelector('b')!.textContent = text
    const close = el.querySelector<HTMLButtonElement>('.u070-x')!
    close.setAttribute('aria-label', closeLabel())
    const t: Item = { el, left: DUR }
    zone.appendChild(el)
    list.unshift(t)
    void el.offsetWidth
    el.classList.remove('enter')
    while (list.length > MAX) remove(list[list.length - 1])
    layout()
    live.textContent = text
    close.addEventListener('click', () => remove(t))

    // Vuốt ngang để bỏ
    let sx = 0
    let dx = 0
    let down = false
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return
      down = true
      sx = e.clientX
      dx = 0
      el.setPointerCapture(e.pointerId)
      el.classList.add('drag')
    })
    el.addEventListener('pointermove', (e) => {
      if (!down) return
      dx = e.clientX - sx
      el.style.setProperty('--dx', dx + 'px')
      el.style.setProperty('--o', String(Math.max(0.2, 1 - Math.abs(dx) / 260)))
    })
    const end = () => {
      if (!down) return
      down = false
      el.classList.remove('drag')
      if (Math.abs(dx) > 90) remove(t, dx > 0 ? 1 : -1)
      else {
        el.style.setProperty('--dx', '0px')
        layout()
      }
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    run()
  }

  const setOpen = (v: boolean) => {
    if (open === v) return
    open = v
    layout()
  }
  const onEnter = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setOpen(true)
  }
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !zone.contains(document.activeElement)) setOpen(false)
  }
  const onFocusIn = () => setOpen(true)
  const onFocusOut = (e: FocusEvent) => {
    if (!zone.contains(e.relatedTarget as Node | null)) setOpen(false)
  }
  const onClick = (e: MouseEvent) => {
    if (!(e.target as Element).closest('button') && list.length > 1) setOpen(!open)
  }
  zone.addEventListener('pointerenter', onEnter)
  zone.addEventListener('pointerleave', onLeave)
  zone.addEventListener('focusin', onFocusIn)
  zone.addEventListener('focusout', onFocusOut)
  zone.addEventListener('click', onClick)

  return {
    push,
    destroy() {
      cancelAnimationFrame(raf)
      raf = 0
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
      zone.removeEventListener('pointerenter', onEnter)
      zone.removeEventListener('pointerleave', onLeave)
      zone.removeEventListener('focusin', onFocusIn)
      zone.removeEventListener('focusout', onFocusOut)
      zone.removeEventListener('click', onClick)
      list.forEach((t) => t.el.remove())
      list = []
      zone.querySelectorAll('.u070-t').forEach((el) => el.remove())
      zone.style.height = '0px'
    },
  }
}
