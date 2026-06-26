// M365 OAuth 팝업 콜백 페이지(공개 라우트 — 토큰 없는 팝업이 착지).
// code/state 를 백엔드로 중계 → 결과를 메인 창에 통지 → 자기 자신을 닫는다.
// 팝업이 아닌 직접 접근(opener 없음)은 /settings/mail 로 graceful 복귀.
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { completeM365OAuth } from '@/api/mailAccounts'
import { BrandMark } from '@/components/layout/BrandMark'
import { M365_OAUTH_SOURCE, notifyOpener } from '@/lib/m365-oauth'

type Phase = 'working' | 'success' | 'error'

export default function M365CallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('working')
  // StrictMode 이중 실행 방어 — 교환은 1회만(state 는 1회 소비).
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const error = searchParams.get('error')
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const hasOpener = !!window.opener

    // AAD 동의 거부 — 백엔드 호출 없이 실패 처리
    if (error || !code || !state) {
      setPhase('error')
      notifyOpener({ source: M365_OAUTH_SOURCE, ok: false, error: error ?? 'invalid_request' })
      if (!hasOpener) {
        toast.error('Outlook 계정 연결에 실패했습니다. 다시 시도해 주세요.')
        void navigate('/settings/mail', { replace: true })
      }
      return
    }

    void completeM365OAuth({ code, state })
      .then(() => {
        setPhase('success')
        notifyOpener({ source: M365_OAUTH_SOURCE, ok: true })
        if (hasOpener) {
          // 팝업이면 잠시 성공 표시 후 닫는다(브라우저가 막으면 수동 안내 노출).
          window.setTimeout(() => window.close(), 800)
        } else {
          toast.success('Outlook 메일 계정이 연결되었습니다.')
          void navigate('/settings/mail', { replace: true })
        }
      })
      .catch(() => {
        setPhase('error')
        notifyOpener({ source: M365_OAUTH_SOURCE, ok: false, error: 'connect_failed' })
        if (!hasOpener) {
          toast.error('Outlook 계정 연결에 실패했습니다. 다시 시도해 주세요.')
          void navigate('/settings/mail', { replace: true })
        }
      })
  }, [searchParams, navigate])

  return (
    <div
      className="flex min-h-svh items-center justify-center bg-background p-6"
      lang="ko"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border bg-card p-8 text-center shadow-sm">
        <BrandMark className="h-10 w-10" />
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
          {phase === 'working' && (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">계정을 연결하는 중…</p>
            </>
          )}
          {phase === 'success' && (
            <>
              <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden />
              <p className="text-sm font-medium">연결되었습니다.</p>
              <p className="text-xs text-muted-foreground">이 창은 곧 닫힙니다. 닫히지 않으면 직접 닫아도 됩니다.</p>
            </>
          )}
          {phase === 'error' && (
            <>
              <XCircle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm font-medium text-destructive">연결에 실패했습니다.</p>
              <p className="text-xs text-muted-foreground">이 창을 닫고 다시 시도해 주세요.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
