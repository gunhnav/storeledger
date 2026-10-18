import { useId } from 'react'

// Logo: tờ hoá đơn + lá non trên nền xanh rừng (giống public/favicon.svg)
export function Logo({ size = 36 }: { size?: number }) {
  const gradient = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f8a52" />
          <stop offset="1" stopColor="#16301f" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradient})`} />
      <path
        d="M19 13h22a3 3 0 0 1 3 3v35l-4-2.6-4 2.6-4-2.6-4 2.6-4-2.6-4 2.6-4-2.6V16a3 3 0 0 1 3-3z"
        fill="#f6f2e9"
      />
      <path d="M22 22h14M22 28h17M22 34h9" stroke="#256b40" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M35 47c0-9 6-15 16-15 0 9-6 15-16 15z"
        fill="#8fd47a"
        stroke="#16301f"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M37 45c3-4 6-7 10-9" stroke="#16301f" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}
