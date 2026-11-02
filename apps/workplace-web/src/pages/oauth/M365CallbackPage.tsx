// M365 OAuth 팝업 콜백 페이지(공개 라우트 — 토큰 없는 팝업이 착지).
// code/state 를 백엔드로 중계 → 결과를 메인 창에 통지 → 자기 자신을 닫는다.
// 완료 API 는 로그인한 본인만 부를 수 있다(WP-1289) — 팝업은 첫 401 에서 refresh 쿠키로 토큰을 받아 다시 보낸다.
// 팝업이 아닌 직접 접근(opener 없음)은 /settings/mail 로 graceful 복귀.
import axios from 'axios'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { completeM365OAuth } from '@/api/mailAccounts'
import { BrandMark } from '@/components/layout/BrandMark'
import { useAuth } from '@/hooks/useAuth'
import { M365_OAUTH_SOURCE, notifyOpener } from '@/lib/m365-oauth'

type Phase = 'working' | 'success' | 'error'

/** 실패 안내 — 기본은 다시 시도, 남의 연결이거나 로그인이 없으면 무엇을 해야 하는지 알려 준다(WP-1289). */
const FAILURE_HINTS = {
  retry: '이 창을 닫고 다시 시도해 주세요.',
  // 403 state_mismatch: 다른 사람이 시작한 연결이거나, 시작한 뒤 다른 워크스페이스로 바뀌었다.
  mismatch: '이 연결은 연결을 시작한 본인이, 시작한 워크스페이스에서만 마칠 수 있습니다. 메일 계정 화면에서 직접 다시 연결해 주세요.',
  login: '로그인한 상태에서 메일 계정 화면의 연결 단추로 다시 시도해 주세요.',
} as const
type FailureHint = keyof typeof FAILURE_HINTS

export default function M365CallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const [phase, setPhase] = useState<Phase>('working')
  const [hint, setHint] = useState<FailureHint>('retry')
  // StrictMode 이중 실행 방어 — 교환은 1회만(state 는 1회 소비).
  const handled = useRef(false)

  useEffect(() => {
    // 완료 API 는 로그인한 본인만 부른다(WP-1289) — 앱의 인증 초기화(refresh)가 끝나 토큰이 선 뒤에 보낸다. 먼저 보내면 401 →
    // 인터셉터 refresh 가 초기화 refresh 와 겹쳐 같은 refresh 쿠키를 두 번 돌린다.
    if (authLoading) return
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

    // 로그인이 없으면 보내지 않는다 — 401 의 refresh 거절이 팝업을 로그인 화면으로 보내지 않게.
    if (!isAuthenticated) {
      setPhase('error')
      setHint('login')
      notifyOpener({ source: M365_OAUTH_SOURCE, ok: false, error: 'unauthenticated' })
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
      .catch((err: unknown) => {
        const mismatch = axios.isAxiosError(err) && err.response?.status === 403
        setPhase('error')
        setHint(mismatch ? 'mismatch' : 'retry')
        notifyOpener({ source: M365_OAUTH_SOURCE, ok: false, error: mismatch ? 'state_mismatch' : 'connect_failed' })
        if (!hasOpener) {
          // 팝업이 아닌 착지는 남에게 받은 링크를 연 경우가 많다 — 다시 시도가 아니라 직접 연결하라고 알린다.
          toast.error(mismatch ? `Outlook 계정을 연결하지 않았습니다. ${FAILURE_HINTS.mismatch}` : 'Outlook 계정 연결에 실패했습니다. 다시 시도해 주세요.')
          void navigate('/settings/mail', { replace: true })
        }
      })
  }, [searchParams, navigate, authLoading, isAuthenticated])

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
              <p className="text-xs text-muted-foreground">{FAILURE_HINTS[hint]}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
