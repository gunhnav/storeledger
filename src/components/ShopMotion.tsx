import type { ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation, m } from 'motion/react'
import { ONCE, SPRING, revealUp } from '../lib/shopMotion'

// Bọc trang cửa hàng: nạp bộ tính năng motion gọn (LazyMotion) và tự giảm hiệu ứng khi máy bật "giảm chuyển động".
// Mọi m.* của trang cửa hàng phải nằm trong khung này (strict).
export function ShopMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

// Khối hiện dần và trượt lên khi cuộn tới (một lần)
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <m.div
      className={className}
      variants={revealUp}
      initial="hidden"
      whileInView="show"
      viewport={ONCE}
      transition={delay ? { delay } : undefined}
    >
      {children}
    </m.div>
  )
}

// Con số nảy nhẹ mỗi khi giá trị đổi (số lượng, số set); style lấy từ CSS của phần tử cha (.shop-qty span)
export function PopNumber({ value }: { value: number | string }) {
  return (
    <m.span key={value} initial={{ scale: 1.3 }} animate={{ scale: 1 }} transition={SPRING}>
      {value}
    </m.span>
  )
}
