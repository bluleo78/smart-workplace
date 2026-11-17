// Claude 앱 연결 동의 화면 /oauth/authorize (WP-1686) — 앱(OAuth 클라이언트)이 연 브라우저가 로그인 뒤 이 주소로 돌아온다.
// 화면은 쿼리를 서버 검증(validate)에 그대로 넘겨 그 결과만 그리고, 「허용」·「거부」는 승인 API 를 한 번 부른 뒤 받은 주소로
// replace 이동만 한다. 상태(확인 중·동의 카드·오류·이동 중·사람 계정 전용·프레임 안)는 spec 상태 3–12 를 따른다.
// ProtectedRoute 안·AppLayout 밖이라 앱 셸 없이 카드 한 장을 화면 가운데에 그린다.
import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { oauthApi } from '@/api/oauth'
import { AuthCardTitle } from '@/components/auth/AuthCardTitle'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import {
  type AuthorizeFailure,
  BAD_REDIRECT_DESCRIPTION,
  CONSENT_PATH,
  DEFAULT_FAILURE_DESCRIPTION,
  isFramed,
  isNavigableRedirect,
  leaveTo,
  loadedDocumentUrl,
  needsDocumentReload,
  readAuthorizeError,
} from '@/lib/oauthConsent'

import { OAuthConsentCard } from './OAuthConsentCard'

/** 승인 응답의 redirectUrl 이 http(s) 가 아닐 때 오류 카드에 보이는 코드(문의용). */
const UNSAFE_REDIRECT_CODE = 'unsafe_redirect'

/** 모든 상태가 공유하는 셸 — main 랜드마크 가운데에 카드 한 장. 390px 에서 좌우 16px 만 남기고 카드가 폭을 채운다. */
function ConsentShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-6">
      <Card className="w-full max-w-md">{children}</Card>
    </main>
  )
}

/** 진행 상태(확인 중·이동 중) — 보이는 문구가 곧 이 상태의 제목이라 h1 을 status 영역 안에 둔다. */
function ProgressCard({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ConsentShell>
      <CardHeader className="text-center">
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          <AuthCardTitle className="text-base">{title}</AuthCardTitle>
        </div>
      </CardHeader>
      {children}
    </ConsentShell>
  )
}

/** 확인 중 카드 — 검증을 기다리는 동안과, 프레임 금지 헤더가 붙은 문서를 다시 받는 동안 같은 모양을 보인다. */
function CheckingCard() {
  return (
    <ProgressCard title="연결 요청을 확인하는 중…">
      {/* 카드 뼈대 — 동의 카드의 정보 상자·단추 자리를 미리 잡는다. */}
      <CardContent className="space-y-3" aria-hidden="true">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </CardContent>
    </ProgressCard>
  )
}

/** 막음 카드(사람 계정 전용·프레임 안) — 제목과 안내 한 줄. 되돌릴 방법이 화면 안에 없으므로 단추가 없다. */
function BlockedCard({ title, message }: { title: string; message: string }) {
  return (
    <ConsentShell>
      <CardHeader className="text-center">
        <AuthCardTitle className="text-xl">{title}</AuthCardTitle>
      </CardHeader>
      <CardContent className="text-center text-sm">
        <p role="alert">{message}</p>
      </CardContent>
    </ConsentShell>
  )
}

/**
 * redirect 없는 오류 카드 — 앱으로 돌려보낼 수 없는(믿을 수 없는 redirect_uri 등) 오류. 어디로도 자동 이동하지 않고,
 * 서버 설명과 문의용 오류 코드를 보인다. 서버가 설명을 비워 보내면 기본 문구로 채운다(빈 줄을 그리지 않는다).
 */
function ErrorCard({ code, description }: { code: string; description: string }) {
  return (
    <ConsentShell>
      <CardHeader className="text-center">
        <AuthCardTitle className="text-xl">연결할 수 없습니다</AuthCardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-center text-sm">
        <div role="alert" className="space-y-2">
          <p className="break-words">{description || DEFAULT_FAILURE_DESCRIPTION}</p>
          <p className="text-muted-foreground">이 창을 닫고 연결하려던 앱에서 다시 시도해 주세요.</p>
        </div>
        <p className="text-xs break-all text-muted-foreground">
          오류 코드 <code>{code}</code>
        </p>
        <Link to="/" className="inline-block text-primary underline-offset-4 hover:underline">
          Gen:iA Works 로 가기
        </Link>
      </CardContent>
    </ConsentShell>
  )
}

/** 일시 실패(5xx·네트워크) 카드 — 같은 요청을 다시 검증하게 「다시 시도」 단추를 둔다. 다시 확인하는 동안은 단추를 막고 돌림표를 보인다. */
function RetryCard({ fetching, onRetry }: { fetching: boolean; onRetry: () => void }) {
  return (
    <ConsentShell>
      <CardHeader className="text-center">
        <div role="alert">
          <AuthCardTitle className="text-xl">연결 요청을 확인하지 못했습니다</AuthCardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button type="button" variant="outline" disabled={fetching} aria-busy={fetching || undefined} onClick={onRetry}>
          {fetching ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          다시 시도
        </Button>
      </CardContent>
    </ConsentShell>
  )
}

const AGENT_TITLE = '사람 계정 전용'
const AGENT_MESSAGE = 'AI 계정으로는 앱을 연결할 수 없습니다. 사람 계정으로 로그인해 다시 시도해 주세요.'

export default function OAuthConsentPage() {
  const { user } = useAuth()
  // location.search 를 그대로 쓴다 — 쿼리를 다시 만들면 서버의 「같은 파라미터 겹침」 검사가 무력해진다.
  const { search } = useLocation()
  // 다른 화면의 iframe 안이면 클릭재킹을 막으려 아무 API 도 부르지 않는다. 열린 뒤 바뀌지 않으므로 처음 한 번만 본다.
  const [framed] = useState(() => isFramed())
  // 프레임 금지 헤더(nginx location = /oauth/authorize)를 받은 문서가 아니면 그리지 않고 그 경로로 문서를 다시 받는다 — 로그인 뒤 SPA 이동
  // (/login·/sso/complete 문서), 끝 슬래시, 대소문자 변형이 같은 화면을 'self' 헤더 문서에 그리는 틈을 한 곳에서 막는다.
  // 문서는 열린 뒤 바뀌지 않으므로 처음 한 번만 본다. 프레임 안이면 막음 카드가 먼저라 다시 받지 않는다.
  // 다시 받을 주소는 정확한 동의 화면 경로에 지금 쿼리를 그대로 붙인 것이다(쿼리를 다시 만들면 서버의 「같은 파라미터 겹침」 검사가 무력해진다).
  const [reloadTo] = useState(() =>
    !framed && needsDocumentReload(loadedDocumentUrl()) ? CONSENT_PATH + search : null,
  )
  const isAgent = user?.kind === 'AGENT'
  // 카드가 넘긴 되돌릴 수 없는 실패(승인 403·이동할 수 없는 주소) — 카드 대신 오류/막음 카드를 그린다.
  const [failure, setFailure] = useState<AuthorizeFailure | null>(null)
  // 이동 중 — 받은 주소로 replace 한 뒤 브라우저가 떠날 때까지 「앱으로 돌아가는 중…」.
  const [leaving, setLeaving] = useState(false)

  const validate = useQuery({
    queryKey: ['oauth-authorize', search],
    queryFn: () => oauthApi.validate(search),
    enabled: !framed && reloadTo === null && user !== null && !isAgent,
    // 재시도는 사용자가 「다시 시도」로만 — 자동 재시도·포커스 재조회로 같은 요청을 몰래 다시 검증하지 않는다.
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // 화면을 떠나면 결과를 바로 버린다 — 떠났다 같은 주소로 다시 열면(뒤로 가기 등) 옛 검증 결과로 카드를 그리지 않고 새로 확인한다.
    gcTime: 0,
  })

  const validateFailure = validate.isError && user ? readAuthorizeError(validate.error, 'validate', user.kind) : null
  // 앱으로 돌려보내는 검증 오류(RFC 6749 §4.1.2.1) — readAuthorizeError 가 http(s) 일 때만 redirect 로 준다.
  const errorRedirect = validateFailure?.kind === 'redirect' ? validateFailure.url : null
  // 화면이 스스로 떠날 주소 — 문서 다시 받기가 먼저, 아니면 앱으로 돌려보내는 검증 오류. 둘은 함께 일어나지 않는다(다시 받는 동안 검증을 부르지 않는다).
  const redirectTarget = reloadTo ?? errorRedirect
  // 같은 주소로 두 번 떠나지 않게(StrictMode 의 효과 두 번 실행 포함) 마지막으로 보낸 주소를 기억한다.
  const leftTo = useRef<string | null>(null)
  useEffect(() => {
    if (redirectTarget && leftTo.current !== redirectTarget) {
      leftTo.current = redirectTarget
      leaveTo(redirectTarget)
    }
  }, [redirectTarget])

  /** 카드가 받은 주소로 떠난다 — 서버 응답이라도 http(s) 절대 주소가 아니면 가지 않고 오류 카드를 보인다. */
  function leave(url: string) {
    if (!isNavigableRedirect(url)) {
      setFailure({ kind: 'fatal', code: UNSAFE_REDIRECT_CODE, description: BAD_REDIRECT_DESCRIPTION })
      return
    }
    setLeaving(true)
    leaveTo(url)
  }

  // 순서가 곧 우선순위다: 프레임 안 → 문서 다시 받는 중 → AI 계정 → 카드가 넘긴 실패 → 이동 중 → 검증 결과.
  if (framed) return <BlockedCard title="연결할 수 없습니다" message="이 화면은 다른 화면 안에서 열 수 없습니다." />
  if (reloadTo) return <CheckingCard />
  // ProtectedRoute 안이라 user 는 늘 있다 — 타입을 좁히려는 방어.
  if (!user) return null
  if (isAgent || failure?.kind === 'agent' || validateFailure?.kind === 'agent') {
    return <BlockedCard title={AGENT_TITLE} message={AGENT_MESSAGE} />
  }
  if (failure?.kind === 'fatal') return <ErrorCard code={failure.code} description={failure.description} />
  if (leaving || errorRedirect) return <ProgressCard title="앱으로 돌아가는 중…" />

  if (validate.isPending) return <CheckingCard />

  // 검증 단계의 400 은 readAuthorizeError 가 늘 fatal 로 준다(inline 은 승인 단계에서만 나와 카드가 다룬다).
  if (validateFailure?.kind === 'fatal') {
    return <ErrorCard code={validateFailure.code} description={validateFailure.description} />
  }
  // 일시 실패(5xx·네트워크) — 같은 요청을 다시 검증하게 한다.
  if (validate.isError) return <RetryCard fetching={validate.isFetching} onRetry={() => void validate.refetch()} />

  return (
    <ConsentShell>
      <OAuthConsentCard request={validate.data} search={search} user={user} onLeave={leave} onFatal={setFailure} />
    </ConsentShell>
  )
}
