// WP-48 SSO 완료 착지 — ProtectedRoute 밖. 서버 콜백이 refresh 쿠키를 심고 이리로 보낸다.
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { NO_WORKSPACE_MESSAGE } from '@/lib/activeTenant'

import { AuthCardTitle } from '../components/auth/AuthCardTitle'
import { WorkspaceSelectCard } from '../components/auth/WorkspaceSelectCard'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { useAuth } from '../hooks/useAuth'
import { safeReturnTo } from '../lib/sso'

export default function SsoCompletePage() {
  const { completeSsoLogin, tenantOptions } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'select' | 'none' | 'failed'>('loading')
  // StrictMode 이중 실행 방지 — refresh 는 1회만.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const returnTo = safeReturnTo(searchParams.get('returnTo'))
    completeSsoLogin()
      .then((result) => {
        if (result === 'entered') navigate(returnTo, { replace: true })
        else setState(result)
      })
      .catch(() => setState('failed'))
  }, [completeSsoLogin, navigate, searchParams])

  if (state === 'failed') return <Navigate to="/login?sso_error=retry" replace />
  if (state === 'select' && tenantOptions) return <WorkspaceSelectCard options={tenantOptions} />
  if (state === 'none') {
    return (
      // WP-1429: 비로그인 화면의 랜드마크·제목 — 바깥은 main, 제목은 CardTitle(div) 과 모양이 같은 h1(AuthCardTitle).
      <main className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <AuthCardTitle className="text-xl">로그인할 수 없습니다</AuthCardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center text-sm">
            <p>{NO_WORKSPACE_MESSAGE}</p>
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">로그인 화면으로</Link>
          </CardContent>
        </Card>
      </main>
    )
  }
  // 세션 확인 중 — 보이는 문구가 곧 이 상태의 제목이라 그대로 h1 로(태그만 바꿔 모양은 같다, WP-1429).
  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      <h1>로그인 중…</h1>
    </main>
  )
}
