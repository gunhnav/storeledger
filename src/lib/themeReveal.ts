/* Lucian UX/UI Prompt #219 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#219 */
// Circular-reveal dark mode: bấm nút giao diện, màn tối lan ra thành vòng tròn từ đúng nút đó đến khi phủ cả trang;
// bấm về sáng thì vòng tối thu lại vào nút. Bản gốc chồng hai bản sao trang rồi cắt bằng clip-path; app thật không nhân đôi trang
// được nên dùng View Transitions API (ảnh chụp trang cũ / mới) với cùng clip-path, thời lượng 0.7s và đường cong của bản gốc.
// Trình duyệt chưa hỗ trợ hoặc máy bật "giảm chuyển động": đổi giao diện ngay, không hiệu ứng. CSS: src/lucian/u219-theme.css

const DURATION = 700
const EASING = 'cubic-bezier(.65,0,.35,1)'

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> }
}

export function revealTheme(origin: HTMLElement, toDark: boolean, apply: () => void): void {
  const doc = document as ViewTransitionDoc
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof doc.startViewTransition !== 'function' || reduced) {
    apply()
    return
  }
  const b = origin.getBoundingClientRect()
  const x = Math.round(b.left + b.width / 2)
  const y = Math.round(b.top + b.height / 2)
  const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)))
  const root = document.documentElement
  root.classList.add('theme-reveal')
  if (!toDark) root.classList.add('theme-reveal-back')

  const vt = doc.startViewTransition(apply)
  vt.ready
    .then(() => {
      const clip = [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`]
      root.animate(
        { clipPath: toDark ? clip : [...clip].reverse() },
        {
          duration: DURATION,
          easing: EASING,
          fill: 'forwards',
          pseudoElement: toDark ? '::view-transition-new(root)' : '::view-transition-old(root)',
        },
      )
    })
    .catch(() => undefined)
  vt.finished.finally(() => root.classList.remove('theme-reveal', 'theme-reveal-back'))
}
