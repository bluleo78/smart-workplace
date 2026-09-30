// 로그아웃 — 서버 세션 종료 후 로그인 화면으로(뒤로가기로 돌아오지 않게 replace).
// 데스크톱 레일 유저 메뉴와 모바일 계정 시트가 같은 동작을 공유한다.
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'

export function useSignOut() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return useCallback(async () => {
    await logout()
    navigate('/login', { replace: true })
  }, [logout, navigate])
}
