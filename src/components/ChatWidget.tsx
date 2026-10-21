import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { Icon } from './Icon'
import { RoonaAvatar } from './RoonaAvatar'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  isError?: boolean
  timestamp?: string
  responseTimeSec?: number
}

// Số tin nhắn gần nhất gửi kèm làm ngữ cảnh hội thoại
const HISTORY_TURNS = 16

const QUICK_PROMPTS = [
  'FIFO hoạt động thế nào?',
  'Bán theo bộ công ty là gì?',
  'Cách tính lãi lỗ và chi phí?',
]

function formatMessageTime(isoString?: string): string {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    const pad = (n: number) => String(n).padStart(2, '0')
    const hours = pad(d.getHours())
    const minutes = pad(d.getMinutes())
    const seconds = pad(d.getSeconds())
    const day = pad(d.getDate())
    const month = pad(d.getMonth() + 1)
    const year = d.getFullYear()
    return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`
  } catch {
    return ''
  }
}

// Mở lại Roona từ nơi khác (menu tài khoản): window.dispatchEvent(new Event(ROONA_OPEN_EVENT))
export const ROONA_OPEN_EVENT = 'roona:open'
const HIDDEN_KEY = 'roona_hidden'
const POS_KEY = 'roona_pos'
// Kéo quá ngưỡng này mới tính là kéo, ít hơn là bấm mở
const DRAG_THRESHOLD = 6

type Pos = { right: number; bottom: number }

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

// Giữ nút trong màn hình (khi xoay máy / đổi cỡ cửa sổ)
const clampPos = (p: Pos, w = 160, h = 56): Pos => ({
  right: Math.min(Math.max(p.right, 8), Math.max(8, window.innerWidth - w - 8)),
  bottom: Math.min(Math.max(p.bottom, 8), Math.max(8, window.innerHeight - h - 8)),
})

// Markdown tối giản cho câu trả lời: **đậm**, dòng "* " / "- " thành gạch đầu dòng. Không dùng innerHTML.
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  )
}

function MessageText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = (key: string) => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={key} className="chat-md-list">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b, `${key}-${i}`)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[*\-•]\s+(.*)$/)
    if (bullet) {
      bullets.push(bullet[1])
      return
    }
    flush(`ul-${i}`)
    if (line.trim() === '') return
    blocks.push(<p key={`p-${i}`}>{renderInline(line, `p-${i}`)}</p>)
  })
  flush('ul-end')
  return <>{blocks}</>
}

function getWelcomeMessage(t: (k: string) => string): Message {
  return {
    id: 'welcome',
    role: 'assistant',
    text: t('Xin chào! Mình là Roona 🤖✨ Bạn cần Roona giải đáp gì về nhập hàng FIFO, bán theo bộ công ty hay cách tính doanh thu lãi lỗ không?'),
  }
}

export function ChatWidget() {
  const { t } = useI18n()
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  // Ẩn hẳn nút Roona (mở lại trong menu tài khoản) và vị trí nút sau khi kéo, nhớ theo máy
  const [hidden, setHidden] = useState(() => readStorage(HIDDEN_KEY, false))
  const [pos, setPos] = useState<Pos>(() => readStorage(POS_KEY, { right: 16, bottom: 16 }))
  const drag = useRef<{ startX: number; startY: number; from: Pos; moved: boolean } | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const storageKey = session?.user?.id ? `soxanh_chat_history_${session.user.id}` : null

  // Khởi tạo tin nhắn từ sessionStorage theo tài khoản đăng nhập
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== 'undefined' && session?.user?.id) {
      try {
        const saved = sessionStorage.getItem(`soxanh_chat_history_${session.user.id}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
      } catch {
        // ignore
      }
    }
    return [getWelcomeMessage(t)]
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const idSeq = useRef(1)
  const openRef = useRef(open)
  const sendTimeRef = useRef(0)

  useEffect(() => {
    openRef.current = open
  }, [open])

  // Bộ đếm giây live khi đang chờ bot trả lời
  useEffect(() => {
    if (!loading) return
    const start = performance.now()
    const timer = setInterval(() => {
      setElapsedSec(Number(((performance.now() - start) / 1000).toFixed(1)))
    }, 100)
    return () => {
      clearInterval(timer)
    }
  }, [loading])

  // Lưu lịch sử vào sessionStorage mỗi khi có tin nhắn mới
  useEffect(() => {
    if (storageKey) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(messages))
      } catch {
        // ignore
      }
    }
  }, [messages, storageKey])

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [open, messages, loading])

  const handleOpen = () => {
    setOpen(true)
    setUnreadCount(0)
  }

  const hideWidget = () => {
    setOpen(false)
    setHidden(true)
    writeStorage(HIDDEN_KEY, true)
  }

  // Menu tài khoản gọi Roona: hiện lại nút và mở khung chat
  useEffect(() => {
    const onOpen = () => {
      setHidden(false)
      writeStorage(HIDDEN_KEY, false)
      setOpen(true)
      setUnreadCount(0)
    }
    window.addEventListener(ROONA_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ROONA_OPEN_EVENT, onOpen)
  }, [])

  // Đổi cỡ màn hình thì kéo nút về trong màn hình
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, toggleRef.current?.offsetWidth, toggleRef.current?.offsetHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Điện thoại: khung chat toàn màn hình, khoá cuộn trang phía sau
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 640px)').matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Giữ và kéo nút Roona đi chỗ khác; chạm nhẹ thì mở chat
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    drag.current = { startX: e.clientX, startY: e.clientY, from: pos, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    setPos(clampPos({ right: d.from.right - dx, bottom: d.from.bottom - dy }, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight))
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) setPos((p) => (writeStorage(POS_KEY, p), p))
    else handleOpen()
  }

  const handleClearHistory = () => {
    const welcome = [getWelcomeMessage(t)]
    setMessages(welcome)
    if (storageKey) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(welcome))
      } catch {
        // ignore
      }
    }
  }

  const handleSend = useCallback(async (questionText?: string) => {
    const textToSend = (questionText ?? input).trim()
    if (!textToSend || loading) return

    sendTimeRef.current = performance.now()
    const currentTime = new Date().toISOString()
    const userMessage: Message = {
      id: 'u_' + idSeq.current++,
      role: 'user',
      text: textToSend,
      timestamp: currentTime,
    }

    setMessages((prev) => [...prev, userMessage])
    if (!questionText) setInput('')
    setElapsedSec(0)
    setLoading(true)

    try {
      const { data, error } = await supabase.functions.invoke<{ answer?: string; error?: string; isError?: boolean; durationMs?: number }>('chat-assistant', {
        body: {
          question: textToSend,
          // Các lượt trước (bỏ lời chào và tin lỗi) để Roona hiểu câu hỏi tiếp nối: quán, món, khoảng ngày
          history: messages
            .filter((m) => m.id !== 'welcome' && !m.isError)
            .slice(-HISTORY_TURNS)
            .map((m) => ({ role: m.role, text: m.text })),
        },
      })

      if (error) {
        let msg = error.message
        if ('context' in error && error.context) {
          try {
            const res = error.context as Response
            const errText = await res.text()
            try {
              const errJson = JSON.parse(errText)
              msg = errJson.error || errJson.answer || errJson.message || errText
            } catch {
              if (errText) msg = errText
            }
          } catch {
            // ignore
          }
        }
        throw new Error(msg || t('Lỗi kết nối tới trợ lý AI'))
      }

      const answer = data?.answer || t('Không có phản hồi từ trợ lý.')
      const totalSec = Number(((performance.now() - sendTimeRef.current) / 1000).toFixed(1))

      setMessages((prev) => [
        ...prev,
        {
          id: 'a_' + idSeq.current++,
          role: 'assistant',
          text: answer,
          isError: data?.isError,
          timestamp: new Date().toISOString(),
          responseTimeSec: totalSec,
        },
      ])

      // Nếu người dùng đang thu nhỏ khung chat, tăng thông báo chưa đọc
      if (!openRef.current) {
        setUnreadCount((c) => c + 1)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('Có lỗi xảy ra, vui lòng thử lại sau.')
      const totalSec = Number(((performance.now() - sendTimeRef.current) / 1000).toFixed(1))

      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + idSeq.current++,
          role: 'assistant',
          text: errMsg,
          isError: true,
          timestamp: new Date().toISOString(),
          responseTimeSec: totalSec,
        },
      ])

      if (!openRef.current) {
        setUnreadCount((c) => c + 1)
      }
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, t])

  return (
    <div
      className={`chat-widget-root${open ? ' is-open' : ''}`}
      style={open ? undefined : { right: pos.right, bottom: pos.bottom }}
      hidden={hidden && !open}
    >
      {!open && (
        <button
          ref={toggleRef}
          type="button"
          className={`chat-toggle-btn${unreadCount > 0 ? ' has-unread' : ''}${loading ? ' is-loading' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleOpen()
            }
          }}
          aria-label={t('Mở trợ lý Roona')}
          title={t('Giữ để kéo, chạm để mở')}
        >
          <span className="chat-toggle-icon-wrap">
            <RoonaAvatar size={42} mood={loading ? 'thinking' : 'happy'} />
            {unreadCount > 0 && (
              <span className="chat-badge" aria-label="Tin nhắn mới">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </span>
          <span className="chat-toggle-label">
            {loading ? `${t('Roona đang nghĩ…')} (${elapsedSec}s)` : 'Roona'}
          </span>
          {loading && <span className="chat-pulsing-dot" aria-hidden="true" />}
        </button>
      )}
      {!open && (
        <button
          type="button"
          className="chat-hide-btn"
          onClick={hideWidget}
          aria-label={t('Ẩn Roona (mở lại trong menu tài khoản)')}
          title={t('Ẩn Roona (mở lại trong menu tài khoản)')}
        >
          <Icon name="close" size={12} />
        </button>
      )}

      {open && (
        <div className="chat-card" role="dialog" aria-label={t('Hộp thoại trợ lý Roona')}>
          <div className="chat-header">
            <div className="chat-header-info">
              <span className="chat-avatar roona-header-avatar">
                <RoonaAvatar size={34} mood="wink" />
              </span>
              <div>
                <strong className="chat-title">Roona</strong>
                <span className="chat-subtitle">{t('Trợ lý ảo vui vẻ & tận tâm')}</span>
              </div>
            </div>
            <div className="chat-header-actions">
              {messages.length > 1 && (
                <button
                  type="button"
                  className="chat-header-btn"
                  onClick={handleClearHistory}
                  title={t('Xoá cuộc trò chuyện')}
                  aria-label={t('Xoá cuộc trò chuyện')}
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
              <button
                type="button"
                className="chat-close-btn"
                onClick={() => setOpen(false)}
                aria-label={t('Đóng')}
                title={t('Đóng')}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          <div className="chat-body">
            {messages.map((m) => {
              const roleClass = m.role === 'user' ? 'chat-user' : 'chat-assistant'
              return (
                <div key={m.id} className={`chat-bubble-wrap ${roleClass}`}>
                  <div className={`chat-bubble ${roleClass}${m.isError ? ' error' : ''}`}>
                    {m.role === 'assistant' ? <MessageText text={m.text} /> : m.text}
                  </div>
                  {m.timestamp && (
                    <div className="chat-meta">
                      <span className="chat-time">{formatMessageTime(m.timestamp)}</span>
                      {m.responseTimeSec !== undefined && (
                        <span className="chat-duration">
                          • {m.responseTimeSec}s
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {loading && (
              <div className="chat-bubble-wrap chat-assistant">
                <div className="chat-bubble chat-assistant typing">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                  <span className="chat-loading-timer">{elapsedSec}s</span>
                </div>
              </div>
            )}

            {messages.length === 1 && !loading && (
              <div className="chat-suggestions">
                <span className="chat-suggestions-title">{t('Gợi ý câu hỏi:')}</span>
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="chat-suggestion-chip"
                    onClick={() => handleSend(prompt)}
                  >
                    {t(prompt)}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form
            className="chat-footer"
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="chat-input"
              placeholder={t('Hỏi về tồn kho, FIFO, cách dùng…')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              className="chat-send-btn"
              disabled={loading || !input.trim()}
              aria-label={t('Gửi')}
            >
              <Icon name="send" size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
