import { useCallback, useEffect, useRef, useState } from 'react'
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
    <div className="chat-widget-root">
      {!open && (
        <button
          type="button"
          className={`chat-toggle-btn${unreadCount > 0 ? ' has-unread' : ''}${loading ? ' is-loading' : ''}`}
          onClick={handleOpen}
          aria-label={t('Mở trợ lý Roona')}
          title={t('Trợ lý Roona')}
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
                    {m.text}
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
