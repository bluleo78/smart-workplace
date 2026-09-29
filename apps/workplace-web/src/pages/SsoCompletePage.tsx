// WP-48 SSO 완료 착지 — ProtectedRoute 밖. 서버 콜백이 refresh 쿠키를 심고 이리로 보낸다.
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { WorkspaceSelectCard } from '../components/auth/WorkspaceSelectCard'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
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
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">로그인할 수 없습니다</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center text-sm">
            <p>접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.</p>
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">로그인 화면으로</Link>
          </CardContent>
        </Card>
      </div>
    )
  }
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">로그인 중…</div>
}
