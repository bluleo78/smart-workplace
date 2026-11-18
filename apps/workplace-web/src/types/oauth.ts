// OAuth 동의 화면(WP-1686) 계약 타입 — 서버 DTO(com.workplace.auth.oauth.dto)와 1:1 이다.
// 서버 이름이 바뀌면 여기와 lib/oauthConsent.ts 의 변환이 함께 바뀌어야 한다.

/** 연결할 수 있는 워크스페이스 한 개(서버 AuthorizeValidateResponse.Workspace). */
export interface AuthorizeWorkspace {
  tenantId: number
  name: string
  slug: string
}

/** 인가 요청 검증 성공 응답 — 동의 화면이 그리는 앱·워크스페이스 정보. */
export interface AuthorizeValidateResponse {
  clientName: string
  /** 앱 홈페이지(CIMD 문서에 있을 때만). */
  clientUri: string | null
  /** 승인 뒤 돌아갈 주소의 호스트 — 사용자가 어디로 가는지 확인하게 보인다. */
  redirectHost: string
  /** DCR 로 등록된 앱이면 true(「확인되지 않은 앱」). */
  unverified: boolean
  workspaces: AuthorizeWorkspace[]
  /** 지금 세션의 워크스페이스(목록에 있을 때만, 아니면 null) — 기본 선택. */
  currentTenantId: number | null
}

export type AuthorizeDecision = 'ALLOW' | 'DENY'

/** 승인·거부 요청 본문 — 인가 요청 파라미터(쿼리에 없으면 키 없음) + 고른 워크스페이스 + 결정. */
export interface AuthorizeDecisionRequest {
  responseType?: string
  clientId?: string
  redirectUri?: string
  codeChallenge?: string
  codeChallengeMethod?: string
  state?: string
  resource?: string
  /** ALLOW 때 필수. DENY 에서는 null 일 수 있다. */
  tenantId: number | null
  decision: AuthorizeDecision
}

/** 승인·거부 응답 — 브라우저를 보낼 클라이언트 redirect 주소(code 가 들어 있다). */
export interface AuthorizeRedirectResponse {
  redirectUrl: string
}

/** 검증·승인 오류 본문. errorRedirectUrl 은 클라이언트·redirect_uri 를 믿을 수 있게 된 뒤의 오류에만 있다. */
export interface OAuthAuthorizeError {
  error: string
  errorDescription: string
  errorRedirectUrl?: string
}

/** 내가 연결해 둔 앱 한 줄(설정 › API 토큰 「연결된 앱」, WP-1687) — 서버 OAuthConnectionResponse(WP-1685)와 1:1. */
export interface OAuthConnection {
  id: number
  clientName: string
  /** DCR 로 등록된 앱이면 true(「확인되지 않은 앱」). */
  unverified: boolean
  /** 앱이 돌아오는 주소의 호스트(없으면 null). */
  redirectHost: string | null
  tenantId: number
  tenantName: string
  createdAt: string
  /** 한 번도 쓰지 않았으면 null. */
  lastUsedAt: string | null
}
