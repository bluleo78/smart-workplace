// src/pages/PushOpenPage.tsx
// 알림 탭으로 새 창이 열릴 때의 진입점(공개 라우트). 미로그인이면 목적지를 저장하고 로그인으로, 로그인 상태면 테넌트 확인 후 이동.
import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { openPushTarget, savePendingPushTarget } from '@/lib/push/openTarget'
import { safeTarget } from '@/sw/logic'

export default function PushOpenPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { isLoading, isAuthenticated, activeTenant, selectTenant } = useAuth()
  const started = useRef(false)

  useEffect(() => {
    if (isLoading || started.current) return
    started.current = true
    const t = Number(params.get('t'))
    const target = { tenantId: Number.isFinite(t) && t > 0 ? t : null, url: safeTarget(params.get('to')) }
    if (!isAuthenticated) {
      savePendingPushTarget(target)
      navigate('/login', { replace: true })
      return
    }
    void openPushTarget(target, {
      activeTenantId: activeTenant?.tenantId ?? null,
      selectTenant,
      navigate: (to) => navigate(to, { replace: true }),
    })
  }, [isLoading, isAuthenticated, activeTenant, selectTenant, navigate, params])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-muted-foreground">이동 중...</div>
    </div>
  )
}
