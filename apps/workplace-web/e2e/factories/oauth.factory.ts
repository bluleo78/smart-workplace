// OAuth 동의 화면(/oauth/authorize, WP-1686) 모킹 팩토리 — 화면 테스트(src/pages/oauth/oauthConsent.test.tsx)와
// E2E(e2e/pages/oauth/oauth-consent.spec.ts)가 같은 인가 요청 주소·validate 응답을 쓰게 한 곳에 둔다.
import type { AuthorizeValidateResponse } from '../../src/types/oauth'

/** 앱(Claude 커넥터)이 연 브라우저가 로그인 뒤 돌아오는 인가 요청 주소 — PKCE(RFC 7636 부록 B 값)·state·resource 를 모두 싣는다. */
export const AUTH_PATH =
  '/oauth/authorize?response_type=code&client_id=swc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=st-1&resource=https%3A%2F%2Fmcp.example%2Fmcp'

/** validate 성공 응답 — 기본은 워크스페이스 하나, 확인된 앱. */
export function validated(over: Partial<AuthorizeValidateResponse> = {}): AuthorizeValidateResponse {
  return {
    clientName: 'Claude',
    clientUri: null,
    redirectHost: 'claude.ai',
    unverified: false,
    workspaces: [{ tenantId: 1, name: 'Work Loop', slug: 'work-loop' }],
    currentTenantId: 1,
    ...over,
  }
}

/** 워크스페이스가 둘인 validate 응답 — 두 번째(tenantId 2)가 지금 세션이라 기본 선택이다. */
export const TWO_WORKSPACES = validated({
  workspaces: [
    { tenantId: 1, name: 'Work Loop', slug: 'work-loop' },
    { tenantId: 2, name: 'Gen:iA Lab', slug: 'genia-lab' },
  ],
  currentTenantId: 2,
})
