import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '../types/database'

export type AuthState = {
  session: Session | null
  profile: Profile | null
  // true cho tới khi biết đã đăng nhập hay chưa và đã tải xong profile
  loading: boolean
  isAdmin: boolean
  isSuperAdmin: boolean
  isPending: boolean
  isApproved: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  // Tải lại profile sau khi người dùng tự sửa tên
  refreshProfile: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải dùng bên trong <AuthProvider>')
  return ctx
}
