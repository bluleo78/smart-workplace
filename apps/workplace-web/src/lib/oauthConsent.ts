// OAuth 동의 화면(WP-1686)의 순수 판정 모음 — 화면(pages/OAuthAuthorizePage)이 쓰는 변환·분기를 React 밖에 두어
// node 환경 단위 테스트로 지킨다. 서버 계약은 WP-1685(OAuthAuthorizeController)이다.
import axios from 'axios'

import type {
  AuthorizeDecision,
  AuthorizeDecisionRequest,
  AuthorizeValidateResponse,
  OAuthAuthorizeError,
} from '@/types/oauth'
import type { UserKind } from '@/types/user'

/** 인가 요청 쿼리 이름(snake_case) → 승인 본문 필드(camelCase). 이 일곱 개만 옮긴다(scope 는 서버가 받지 않는다). */
const QUERY_TO_BODY = [
  ['response_type', 'responseType'],
  ['client_id', 'clientId'],
  ['redirect_uri', 'redirectUri'],
  ['code_challenge', 'codeChallenge'],
  ['code_challenge_method', 'codeChallengeMethod'],
  ['state', 'state'],
  ['resource', 'resource'],
] as const

/**
 * 서버가 오류 설명(errorDescription·message)을 주지 않았을 때 오류 카드·단추 위 오류 줄에 대신 보이는 문구.
 * readAuthorizeError 는 설명이 없으면 description 을 '' 로 두므로, 화면이 빈 줄을 그리지 않게 이 문구로 채운다.
 */
export const DEFAULT_FAILURE_DESCRIPTION = '연결 요청을 처리하지 못했습니다.'

/** 앱이 알려 준 돌아갈 주소가 http(s) 가 아닐 때 보이는 문구 — 승인 응답의 redirectUrl 을 거를 때 화면도 같은 문구를 쓴다. */
export const BAD_REDIRECT_DESCRIPTION = '앱이 알려 준 돌아갈 주소가 올바르지 않습니다.'

/**
 * location.search 로 만든 URLSearchParams 를 승인 본문으로 옮긴다.
 * 이름마다 첫 값(params.get)만 쓰고, 쿼리에 없으면 키 자체를 뺀다 — 서버가 validate 쿼리를 디코드한 값과 같아야
 * (`+` → 공백, `%2B` → `+`) 다시 검증할 때 「요청이 바뀌었다」로 거절되지 않는다. URLSearchParams 는 서버와 같은 규칙으로 디코드한다.
 */
export function decisionBody(
  params: URLSearchParams,
  tenantId: number | null,
  decision: AuthorizeDecision,
): AuthorizeDecisionRequest {
  const body: AuthorizeDecisionRequest = { tenantId, decision }
  for (const [query, field] of QUERY_TO_BODY) {
    const value = params.get(query)
    if (value !== null) body[field] = value
  }
  return body
}

/**
 * 기본으로 고를 워크스페이스 — 지금 세션의 워크스페이스가 목록에 있으면 그것, 아니면 첫 항목, 목록이 비면 null.
 * (서버가 currentTenantId 를 목록에 있을 때만 주지만, 화면이 어긋난 값에 선택 불가 상태가 되지 않게 한 번 더 거른다.)
 */
export function initialTenantId(v: Pick<AuthorizeValidateResponse, 'workspaces' | 'currentTenantId'>): number | null {
  if (v.currentTenantId !== null && v.workspaces.some((w) => w.tenantId === v.currentTenantId)) {
    return v.currentTenantId
  }
  return v.workspaces[0]?.tenantId ?? null
}

/**
 * 브라우저를 보내도 되는 주소인가 — 절대 주소이면서 http(s) 만 허용한다.
 * 서버 응답이라도 `javascript:`·`data:` 로 이동하면 스크립트가 도므로 이동 직전에 항상 거른다.
 */
export function isNavigableRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 서버 오류가 화면에서 어떤 상태가 되는가.
 * - redirect: 앱으로 오류를 들고 돌아간다(RFC 6749 §4.1.2.1)
 * - inline: 카드 안에 오류 문구를 띄우고 다시 시도하게 한다(승인 단계 400)
 * - fatal: 오류 카드, 되돌릴 수 없다
 * - agent: AI 계정은 앱 연결을 승인할 수 없다는 안내
 * - transient: 잠시 뒤 다시 시도(5xx·네트워크·401)
 */
export type AuthorizeFailure =
  | { kind: 'redirect'; url: string }
  | { kind: 'inline' | 'fatal'; code: string; description: string }
  | { kind: 'agent' }
  | { kind: 'transient' }

/** 오류 응답 본문을 객체로 읽는다 — 객체가 아니면 빈 객체(필드는 모두 없는 셈). axios 오류인지는 부르는 쪽이 이미 확인했다. */
function bodyOf(response: { data?: unknown }): Record<string, unknown> {
  const data = response.data
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
}

/** 문자열 필드만 꺼낸다(아니면 undefined). */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * 검증·승인 호출의 오류를 화면 상태로 바꾼다.
 * 400 이면서 errorRedirectUrl 이 있으면 http(s) 일 때만 redirect — 아니면(javascript: 등) 이동하지 않고 fatal 이다
 * (서버가 성공 redirect 만이 아니라 오류 redirect 도 신뢰 경계라서 여기서도 거른다). 400 단독은 검증 단계면 fatal,
 * 승인 단계면 inline. 403 은 AI 계정이면 agent, 사람이면 fatal. 그 밖(5xx·네트워크·401)은 transient.
 */
export function readAuthorizeError(err: unknown, phase: 'validate' | 'decide', userKind: UserKind): AuthorizeFailure {
  if (!axios.isAxiosError(err) || !err.response) return { kind: 'transient' }
  const status = err.response.status
  const data = bodyOf(err.response) as Partial<Record<keyof OAuthAuthorizeError | 'message', unknown>>

  if (status === 400) {
    const redirectUrl = str(data.errorRedirectUrl)
    if (redirectUrl) {
      if (isNavigableRedirect(redirectUrl)) return { kind: 'redirect', url: redirectUrl }
      return { kind: 'fatal', code: str(data.error) ?? 'error', description: BAD_REDIRECT_DESCRIPTION }
    }
    // 오류 코드(invalid_redirect_uri 등)는 오류 카드의 작은 글자로 보인다 — 사용자가 문의할 때 쓸 수 있게 서버 값을 그대로 싣는다.
    return {
      kind: phase === 'validate' ? 'fatal' : 'inline',
      code: str(data.error) ?? 'error',
      description: str(data.errorDescription) ?? '',
    }
  }
  if (status === 403) {
    if (userKind === 'AGENT') return { kind: 'agent' }
    return { kind: 'fatal', code: str(data.error) ?? 'forbidden', description: str(data.message) ?? '' }
  }
  return { kind: 'transient' }
}

/**
 * 앱 머리글자 타일에 넣을 글자 — 앞뒤 공백을 지운 첫 코드 포인트를 대문자로, 비어 있으면 '?'.
 * charAt(0) 은 이모지·보충 평면 글자를 반쪽으로 자르므로 Array.from 으로 코드 포인트 단위로 자른다.
 * 대문자로 바꾸면 여러 글자가 되는 글자('ß' → 'SS')가 있어 바꾼 결과의 첫 코드 포인트만 쓴다(타일은 늘 한 글자).
 */
export function appInitial(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? Array.from(first.toUpperCase())[0] : '?'
}

/**
 * 다른 페이지의 iframe 안에서 열렸는가 — 동의 화면은 클릭재킹을 막으려 프레임 안이면 그리지 않는다.
 * 다른 출처 프레임에서 top 을 읽다 예외가 나도 프레임 안이라는 뜻이므로 true.
 */
export function isFramed(win: Window = window): boolean {
  try {
    return win.top !== win.self
  } catch {
    return true
  }
}

/** 브라우저를 url 로 보낸다(뒤로 가기에 동의 화면을 남기지 않는 replace). 화면 테스트가 vi.mock 으로 막는 지점이다. */
export function leaveTo(url: string): void {
  window.location.replace(url)
}

/** 동의 화면 경로 — nginx 가 정확 일치(location = /oauth/authorize)로만 프레임 금지 헤더(frame-ancestors 'none'·DENY)를 붙인다. */
export const CONSENT_PATH = '/oauth/authorize'

/**
 * 지금 문서를 브라우저가 받은 주소 — navigation 항목의 이름(첫 문서 요청의 최종 주소)이다. SPA 이동(history.pushState)은 이 값을 바꾸지
 * 않으므로 「화면 주소」가 아니라 「응답 헤더를 받은 주소」를 알 수 있다. 항목이나 API 가 없으면(jsdom·happy-dom) undefined.
 * 화면 테스트가 vi.mock 으로 값을 주는 지점이다.
 */
export function loadedDocumentUrl(perf: Performance | undefined = globalThis.performance): string | undefined {
  if (typeof perf?.getEntriesByType !== 'function') return undefined
  const entry = perf.getEntriesByType('navigation')[0]
  return entry?.name || undefined
}

/**
 * 동의 화면을 그리기 전에 문서를 다시 받아야 하는가(WP-1686 클릭재킹 방어).
 * 프레임 금지 헤더는 문서를 정확히 `/oauth/authorize` 로 받을 때만 붙는다. 로그인 뒤 SPA 이동(문서는 /login·/sso/complete 의 'self'),
 * 끝 슬래시(`/oauth/authorize/`), 대소문자 변형(`/OAuth/Authorize` — React Router 는 대소문자를 무시한다)으로 들어오면 같은 화면이
 * 헤더 없는 문서에 그려지므로 true. 문서 주소를 알 수 없으면(테스트 환경) 확인할 수 없으니 false — 그대로 그린다.
 * `CONSENT_PATH + 지금 쿼리` 로 다시 받은 문서는 경로가 정확히 같아 false 가 되므로 이동이 되풀이되지 않는다.
 */
export function needsDocumentReload(documentUrl: string | undefined): boolean {
  if (!documentUrl) return false
  try {
    return new URL(documentUrl).pathname !== CONSENT_PATH
  } catch {
    return false
  }
}
