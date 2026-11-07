import type { ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation, m } from 'motion/react'
import { SPRING } from '../lib/shopMotion'

// Bọc trang cửa hàng: nạp bộ tính năng motion gọn (LazyMotion) và tự giảm hiệu ứng khi máy bật "giảm chuyển động".
// Mọi m.* của trang cửa hàng phải nằm trong khung này (strict).
export function ShopMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
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
