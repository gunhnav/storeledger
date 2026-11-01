// Kiểu chuyển động dùng chung cho trang đặt hàng công khai (theo phong cách Animate UI: nhẹ, lò xo, hiện dần khi cuộn tới).
// Thư viện motion chỉ nạp cùng trang cửa hàng (chunk riêng), không ảnh hưởng các trang quản trị.
import type { Transition, Variants } from 'motion/react'

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

// Lò xo ngắn cho nút bấm, số lượng, huy hiệu
export const SPRING: Transition = { type: 'spring', stiffness: 520, damping: 28 }
// Lò xo mềm hơn cho hộp thoại, thanh giỏ hàng
export const SOFT_SPRING: Transition = { type: 'spring', stiffness: 380, damping: 32 }

// Phần tử con hiện dần và trượt lên nhẹ
export const revealUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
}

// Khung cha: các phần tử con (revealUp) hiện nối tiếp nhau
export const stagger = (gap = 0.07, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
})

// Chỉ phát hiệu ứng một lần khi phần tử vào khung nhìn
export const ONCE = { once: true, amount: 0.2 } as const
