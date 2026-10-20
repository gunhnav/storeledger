export interface RoonaAvatarProps {
  size?: number
  mood?: 'happy' | 'thinking' | 'wink'
  className?: string
}

/**
 * Avatar trợ lý ảo Roona:
 * Robot mini siêu cute, hài hước, mắt lấp lánh/nháy mắt, má hồng, tai nghe và ăng-ten ngôi sao.
 */
export function RoonaAvatar({ size = 44, mood = 'happy', className = '' }: RoonaAvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`roona-avatar ${className}`}
      aria-hidden="true"
    >
      <defs>
        {/* Gradient vỏ robot */}
        <linearGradient id="roonaBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>

        {/* Gradient tai nghe / điểm nhấn */}
        <linearGradient id="roonaAccentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff7675" />
          <stop offset="100%" stopColor="#fd79a8" />
        </linearGradient>

        {/* Gradient màn hình kính */}
        <linearGradient id="roonaScreenGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e272e" />
          <stop offset="100%" stopColor="#0f1419" />
        </linearGradient>

        {/* Ánh sáng ăng-ten */}
        <radialGradient id="roonaStarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff275" />
          <stop offset="70%" stopColor="#ffd32a" />
          <stop offset="100%" stopColor="#ffa801" />
        </radialGradient>

        <filter id="roonaGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Quai tai nghe */}
      <path
        d="M 11 30 C 11 15, 53 15, 53 30"
        fill="none"
        stroke="#718096"
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* Ăng-ten */}
      <line x1="32" y1="14" x2="32" y2="8" stroke="#a0aec0" strokeWidth="2.5" strokeLinecap="round" />
      {/* Ngôi sao / ngọc phát sáng trên ăng-ten */}
      <circle cx="32" cy="6.5" r="4.2" fill="url(#roonaStarGlow)" filter="url(#roonaGlow)" />
      <circle cx="30.8" cy="5.2" r="1.3" fill="#ffffff" />

      {/* Tai nghe trái & phải */}
      <rect x="5.5" y="24" width="5.5" height="15" rx="2.75" fill="url(#roonaAccentGrad)" />
      <rect x="53" y="24" width="5.5" height="15" rx="2.75" fill="url(#roonaAccentGrad)" />

      {/* Đầu robot bo tròn dễ thương */}
      <rect
        x="9"
        y="14"
        width="46"
        height="40"
        rx="18"
        fill="url(#roonaBodyGrad)"
        stroke="#cbd5e1"
        strokeWidth="1.6"
      />

      {/* Màn hình hiển thị gương mặt */}
      <rect
        x="13"
        y="18"
        width="38"
        height="32"
        rx="14"
        fill="url(#roonaScreenGrad)"
        stroke="#2d3436"
        strokeWidth="1.2"
      />

      {/* Vệt bóng kính phản chiếu */}
      <path
        d="M 17 21 C 24 19.5, 40 19.5, 47 21 C 44 24, 20 24, 17 21 Z"
        fill="#ffffff"
        opacity="0.22"
      />

      {/* --- BIỂU CẢM KHUÔN MẶT CỦA ROONA --- */}

      {/* Lông mày hài hước: bên cao bên thấp biểu cảm tinh nghịch */}
      <path d="M 20 24 Q 24 22 27 24" stroke="#00d2d3" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M 37 23 Q 41 21 44 24" stroke="#00d2d3" strokeWidth="1.8" strokeLinecap="round" />

      {/* Mắt trái: to tròn long lanh */}
      {mood === 'thinking' ? (
        <path d="M 21 31 Q 25 27 29 31" stroke="#00d2d3" strokeWidth="2.8" strokeLinecap="round" />
      ) : (
        <g>
          <circle cx="25" cy="31" r="4.2" fill="#00d2d3" />
          <circle cx="23.6" cy="29.4" r="1.5" fill="#ffffff" />
          <circle cx="26.8" cy="32.4" r="0.8" fill="#ffffff" />
        </g>
      )}

      {/* Mắt phải: nháy mắt tinh nghịch (wink) hoặc to tròn */}
      {mood === 'thinking' ? (
        <path d="M 35 31 Q 39 27 43 31" stroke="#00d2d3" strokeWidth="2.8" strokeLinecap="round" />
      ) : mood === 'wink' || mood === 'happy' ? (
        <path
          d="M 35 31 Q 39 26 43 31"
          stroke="#00d2d3"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <g>
          <circle cx="39" cy="31" r="4.2" fill="#00d2d3" />
          <circle cx="37.6" cy="29.4" r="1.5" fill="#ffffff" />
          <circle cx="40.8" cy="32.4" r="0.8" fill="#ffffff" />
        </g>
      )}

      {/* Má hồng chúm chím dễ thương */}
      <ellipse cx="19" cy="38" rx="3.2" ry="2" fill="#ff7675" opacity="0.85" />
      <ellipse cx="45" cy="38" rx="3.2" ry="2" fill="#ff7675" opacity="0.85" />

      {/* Miệng cười hài hước lè lưỡi / cười tươi */}
      {mood === 'thinking' ? (
        <ellipse cx="32" cy="40" rx="2.5" ry="3.5" fill="#ff4757" />
      ) : (
        <g>
          <path
            d="M 27 37 Q 32 37 37 37 Q 37 44 32 44 Q 27 44 27 37 Z"
            fill="#ff4757"
          />
          {/* Lưỡi hồng */}
          <path
            d="M 29.5 41 Q 32 39.5 34.5 41 Q 34.5 44 32 44 Q 29.5 44 29.5 41 Z"
            fill="#ff9ff3"
          />
        </g>
      )}
    </svg>
  )
}
