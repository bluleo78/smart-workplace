import { createContext } from 'react'

import type { PlatformUser } from '../types/platform'

// 운영자 콘솔 인증 컨텍스트 값.
// 플랫폼 토큰은 tenant 가 없으므로 roles/isAdmin/activeTenant/selectTenant 는 없다.
export interface PlatformAuthContextValue {
  user: PlatformUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null)
