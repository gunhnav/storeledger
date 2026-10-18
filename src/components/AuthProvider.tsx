import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthState } from '../lib/auth'
import type { Profile } from '../types/database'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  // Profile gắn với user id đã tải, để biết profile hiện tại có khớp session không
  const [loaded, setLoaded] = useState<{ userId: string; profile: Profile | null } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionReady(true)
    })
    // Không gọi hàm supabase khác (await) trong callback này để tránh treo client
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setLoaded({ userId, profile: data })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const profile = userId && loaded?.userId === userId ? loaded.profile : null
  const loading = !sessionReady || (userId !== null && loaded?.userId !== userId)

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, profile, loading, isAdmin: profile?.role === 'admin', signIn, signOut }),
    [session, profile, loading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
