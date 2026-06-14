import { useContext } from 'react'

import type { PlatformAuthContextValue } from './platform-auth-context-value'
import { PlatformAuthContext } from './platform-auth-context-value'

// 컨텍스트 소비 훅 — Provider 밖에서 호출 시 명시적 에러.
export function useAuth(): PlatformAuthContextValue {
  const context = useContext(PlatformAuthContext)
  if (!context) {
    throw new Error('useAuth must be used within a PlatformAuthProvider')
  }
  return context
}
