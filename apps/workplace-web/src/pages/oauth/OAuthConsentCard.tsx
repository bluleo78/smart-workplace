// Claude 앱 연결 동의 카드(WP-1686) — 서버 검증(validate)을 통과한 인가 요청을 사람에게 보이고 「허용」·「거부」를 받는다.
// 카드는 앱 머리·「확인되지 않은 앱」 안내·계정/워크스페이스/권한 정보 상자·단추·끊기 안내만 그리고, 이동과 오류 카드는
// 화면 셸(OAuthConsentPage)에 맡긴다(onLeave·onFatal). 승인 응답에는 1회용 code 가 들어 있어 Query 캐시에 두지 않는다.
import { useMutation } from '@tanstack/react-query'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { oauthApi } from '@/api/oauth'
import { AuthCardTitle } from '@/components/auth/AuthCardTitle'
import { BrandMark } from '@/components/layout/BrandMark'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader } from '@/components/ui/card'
import {
  appInitial,
  type AuthorizeFailure,
  decisionBody,
  DEFAULT_FAILURE_DESCRIPTION,
  initialTenantId,
  readAuthorizeError,
} from '@/lib/oauthConsent'
import type { UserResponse } from '@/types/auth'
import type { AuthorizeDecision, AuthorizeValidateResponse } from '@/types/oauth'

/** 승인이 5xx·네트워크로 실패했을 때 단추 위에 보이는 문구 — 같은 요청을 다시 눌러 보내면 된다. */
const RETRY_LATER = '잠시 뒤 다시 눌러 주세요.'

/** 정보 상자 한 줄의 모양 — 라벨은 왼쪽, 값은 오른쪽. 390px 에서 긴 값이 줄바꿈되도록 값 칸에 min-w-0 을 준다. */
const ROW = 'flex items-start justify-between gap-3 px-3 py-2.5'
const VALUE = 'min-w-0 text-right break-words'

type Props = {
  /** 서버 검증 결과 — 앱 이름·돌아갈 호스트·확인 여부·고를 수 있는 워크스페이스. */
  request: AuthorizeValidateResponse
  /** location.search 그대로 — 승인 본문은 여기서 다시 읽는다(서버가 validate 쿼리를 디코드한 값과 같아야 한다). */
  search: string
  /** 지금 로그인한 계정 — 화면이 「누구로」 연결하는지 밝힌다(서버 응답엔 계정이 없다). */
  user: UserResponse
  /** 받은 redirect 주소로 떠난다(셸이 http(s) 를 확인한 뒤 replace). */
  onLeave: (url: string) => void
  /** 되돌릴 수 없는 실패(사람 계정 전용·오류 카드)를 셸에 넘긴다. */
  onFatal: (failure: AuthorizeFailure) => void
}

export function OAuthConsentCard({ request, search, user, onLeave, onFatal }: Props) {
  const [tenantId, setTenantId] = useState<number | null>(() => initialTenantId(request))
  // 단추 위 오류 줄(승인 400 단독·일시 실패) — 다른 워크스페이스를 고르거나 다시 누를 수 있게 카드는 그대로 둔다.
  const [notice, setNotice] = useState<string | null>(null)
  // 진행 중 막음 — 두 단추가 함께 쓰는 ref 하나. 같은 틱에 「거부」 뒤 「허용」(또는 허용 두 번)이 와도 다시 그리기 전이라
  // disabled 가 아직 안 붙으므로, 상태가 아닌 ref 로 막아야 POST 가 한 번만 나간다(한 번 = code 한 개).
  const inFlight = useRef(false)
  const selectId = useId()

  const decide = useMutation({
    mutationFn: ({ decision, tenantId: chosen }: { decision: AuthorizeDecision; tenantId: number | null }) =>
      oauthApi.decide(decisionBody(new URLSearchParams(search), chosen, decision)),
    // code 가 든 응답을 뮤테이션 캐시에도 오래 두지 않는다.
    gcTime: 0,
    onSuccess: (res) => onLeave(res.redirectUrl),
    onError: (err) => {
      const failure = readAuthorizeError(err, 'decide', user.kind)
      switch (failure.kind) {
        case 'redirect':
          onLeave(failure.url)
          return
        case 'agent':
        case 'fatal':
          onFatal(failure)
          return
        case 'inline':
          setNotice(failure.description || DEFAULT_FAILURE_DESCRIPTION)
          break
        case 'transient':
          setNotice(RETRY_LATER)
          break
      }
      // 카드에 남는 실패 — 단추를 다시 켜 고쳐서 다시 보낼 수 있게 한다.
      inFlight.current = false
    },
  })

  /** 「허용」·「거부」 — 이미 보내는 중이면 무시한다. */
  function send(decision: AuthorizeDecision) {
    if (inFlight.current) return
    inFlight.current = true
    setNotice(null)
    decide.mutate({ decision, tenantId })
  }

  const busy = decide.isPending
  const sending = busy ? decide.variables?.decision : undefined
  const { workspaces } = request
  // 워크스페이스가 둘 이상이면 셀렉트로 고르게 한다(라벨 정렬·label 연결·값 칸이 함께 바뀐다).
  const multi = workspaces.length > 1

  return (
    <>
      {/* grid-cols-[minmax(0,1fr)] — CardHeader 는 grid 라 열이 auto 면 h1 의 min-content 까지 넓어진다. 타사 앱이 정한 끊을 자리 없는
          긴 앱 이름이 390px 에서 카드를 밀어내지 않도록 열 폭을 카드 안으로 고정한다(break-words 가 그 안에서 줄을 바꾼다). */}
      <CardHeader className="grid-cols-[minmax(0,1fr)] gap-3 text-center">
        {/* 앱 ↔ Gen:iA Works 머리 — 장식(앱 이름은 h1 에 있다). 로고는 받지 않으므로 앱 이름 첫 글자 타일로 그린다. */}
        <div className="flex items-center justify-center gap-3" aria-hidden="true">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
            {appInitial(request.clientName)}
          </span>
          <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          <BrandMark />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <AuthCardTitle className="min-w-0 text-xl break-words">{`${request.clientName} 연결`}</AuthCardTitle>
          {request.unverified && (
            <span className="rounded-md bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning-text">
              확인되지 않은 앱
            </span>
          )}
        </div>
        {/* 돌아갈 주소의 호스트 — 사용자가 연결하려던 앱이 맞는지 확인하는 근거. 긴 호스트도 넘치지 않게 아무 데서나 끊는다. */}
        <p className="text-sm break-all text-muted-foreground">{request.redirectHost}</p>
        {request.unverified && (
          <p className="text-sm text-muted-foreground">
            Gen:iA Works 가 확인하지 않은 앱입니다. 위 주소가 연결하려던 앱이 맞는지 확인하세요.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="divide-y rounded-md border text-sm">
          <div className={ROW}>
            <dt className="shrink-0 text-muted-foreground">계정</dt>
            <dd className={VALUE}>
              <span className="block font-semibold">{user.name}</span>
              <span className="block text-xs text-muted-foreground">{user.email ?? user.username}</span>
            </dd>
          </div>
          <div className={ROW}>
            {/* 셀렉트 줄은 트리거 높이에 맞춰 라벨을 세로 가운데로 둔다. */}
            <dt className={multi ? 'shrink-0 self-center text-muted-foreground' : 'shrink-0 text-muted-foreground'}>
              {/* 셀렉트일 때만 라벨로 잇는다 — 스크린리더가 셀렉트를 「워크스페이스」로 읽는다. */}
              {multi ? <label htmlFor={selectId}>워크스페이스</label> : '워크스페이스'}
            </dt>
            {multi ? (
              // 값 칸이 줄의 60% 를 넘지 않게 해 라벨이 눌리지 않게 하고, 트리거는 그 안에서 긴 이름을 자른다.
              <dd className="flex min-w-0 max-w-[60%] justify-end">
                <Select
                  value={tenantId === null ? undefined : String(tenantId)}
                  onValueChange={(v) => setTenantId(Number(v))}
                  disabled={busy}
                >
                  <SelectTrigger id={selectId} className="max-w-full min-w-0">
                    <SelectValue className="min-w-0" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((w) => (
                      <SelectItem key={w.tenantId} value={String(w.tenantId)}>
                        <span className="truncate">{w.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </dd>
            ) : workspaces.length === 1 ? (
              <dd className={VALUE}>{workspaces[0].name}</dd>
            ) : (
              <dd className={`${VALUE} text-muted-foreground`}>연결할 수 있는 워크스페이스가 없습니다</dd>
            )}
          </div>
          <div className={ROW}>
            <dt className="shrink-0 text-muted-foreground">권한</dt>
            <dd className={VALUE}>
              <span className="block">내 권한 그대로 · 읽기·쓰기</span>
              <span className="block text-xs text-muted-foreground">이슈·노트·드라이브·메일·채널·캘린더·연락처</span>
            </dd>
          </div>
        </dl>
        {notice && (
          <p role="alert" className="text-sm text-destructive-text">
            {notice}
          </p>
        )}
        {/* 자동 포커스를 주지 않는다 — 열자마자 Enter 로 승인되지 않게. 보내는 중엔 두 단추를 함께 끈다. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => send('DENY')}
          >
            {sending === 'DENY' && <Loader2 className="animate-spin" aria-hidden="true" />}
            거부
          </Button>
          <Button
            type="button"
            disabled={busy || tenantId === null}
            aria-busy={busy || undefined}
            onClick={() => send('ALLOW')}
          >
            {sending === 'ALLOW' && <Loader2 className="animate-spin" aria-hidden="true" />}
            허용
          </Button>
        </div>
        {/* 링크가 아닌 글자 — 동의 도중 다른 화면으로 새지 않게 경로만 알린다. */}
        <p className="text-center text-xs text-muted-foreground">연결 끊기: 설정 › API 토큰 › 연결된 앱</p>
      </CardContent>
    </>
  )
}
