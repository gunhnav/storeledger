import { useState, type ComponentProps } from 'react'
import { useI18n } from '../lib/i18n'
import { Icon } from './Icon'

// Ô mật khẩu che ký tự, có nút con mắt để hiện / ẩn (nhận thẳng props của register)
export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  return (
    <span className="password-input">
      <input {...props} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        aria-label={show ? t('Ẩn mật khẩu') : t('Hiện mật khẩu')}
        title={show ? t('Ẩn mật khẩu') : t('Hiện mật khẩu')}
        aria-pressed={show}
        onClick={() => setShow((v) => !v)}
      >
        <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </span>
  )
}
