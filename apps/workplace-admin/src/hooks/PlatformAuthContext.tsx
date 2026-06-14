import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { setAccessToken } from '../api/client'
import { platformAuth } from '../api/platformAuth'
import type { PlatformUser } from '../types/platform'
import type { PlatformAuthContextValue } from './platform-auth-context-value'
import { PlatformAuthContext } from './platform-auth-context-value'

const AUTH_FLAG_KEY = 'hasSession'

// 운영자 콘솔 인증 Provider.
// - 마운트 시 hasSession 플래그가 있으면 refresh 쿠키로 세션 복원
// - login/logout/refreshUser 노출. 플랫폼 토큰은 tenant 가 없어 단순하다.
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAuthenticated = user !== null

  const fetchMe = useCallback(async () => {
    const { data } = await platformAuth.me()
    setUser(data)
    return data
  }, [])

  useEffect(() => {
    let ignore = false

    const initAuth = async () => {
      if (!localStorage.getItem(AUTH_FLAG_KEY)) {
        setIsLoading(false)
        return
      }

      try {
        const { data: tokens } = await platformAuth.refresh()
        if (ignore) return
        setAccessToken(tokens.accessToken)
        await fetchMe()
      } catch {
        if (ignore) return
        // refresh 실패(만료/권한 상실) → 세션 정리.
        setAccessToken(null)
        localStorage.removeItem(AUTH_FLAG_KEY)
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }

    initAuth()
    return () => {
      ignore = true
    }
  }, [fetchMe])

  const login = useCallback(
    async (username: string, password: string) => {
      const { data: tokens } = await platformAuth.login({ username, password })
      setAccessToken(tokens.accessToken)
      try {
        await fetchMe()
        localStorage.setItem(AUTH_FLAG_KEY, '1')
      } catch (e) {
        // me 로드 실패 시 부분 상태를 되돌려 init 과 대칭 유지
        setAccessToken(null)
        localStorage.removeItem(AUTH_FLAG_KEY)
        throw e
      }
    },
    [fetchMe],
  )

  const logout = useCallback(async () => {
    try {
      await platformAuth.logout()
    } catch {
      // 로그아웃 API 실패는 무시 — 로컬 세션은 어쨌든 정리한다.
    } finally {
      setAccessToken(null)
      localStorage.removeItem(AUTH_FLAG_KEY)
      setUser(null)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    await fetchMe()
  }, [fetchMe])

  const ctxValue = useMemo<PlatformAuthContextValue>(
    () => ({ user, isLoading, isAuthenticated, login, logout, refreshUser }),
    [user, isLoading, isAuthenticated, login, logout, refreshUser],
  )

  return <PlatformAuthContext value={ctxValue}>{children}</PlatformAuthContext>
}
