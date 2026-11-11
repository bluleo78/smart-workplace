// WP-1496: Anthropic 자격증명의 인증 방식 판정(모델 조회)과 워크스페이스 ID 정리(실행·모델 조회 공용).

/**
 * 토큰이 x-api-key 로 인증하는 API 키인가 — 표준 API 키(sk-ant-api…)와 사용자 API 키(sk-ant-usr…, 워크스페이스에 묶인 키는
 * `anthropic-workspace-id` 헤더가 있어야 한다). false 면 그 밖(구독 OAuth sk-ant-oat… 등)이라 Bearer + oauth 베타 헤더로 인증한다.
 * 모르는 접두는 지금까지처럼 구독 OAuth 로 다룬다.
 */
export function usesApiKeyAuth(token: string): boolean {
  return token.startsWith('sk-ant-api') || token.startsWith('sk-ant-usr');
}

// 헤더 값으로 안전한 워크스페이스 ID — 보이는 ASCII(공백 제외) 1~128자. api 도 저장 때 거르지만, 여기서도 줄바꿈·제어 문자를
// 걸러 다른 헤더를 주입하지 못하게 한다(심층 방어).
const SAFE_WORKSPACE_ID = /^[\x21-\x7E]{1,128}$/;

/** 워크스페이스 ID 를 앞뒤 공백만 떼어 돌려준다. 비었거나 공백·제어·비 ASCII 문자가 섞였거나 128자를 넘으면 null. */
export function safeWorkspaceId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return SAFE_WORKSPACE_ID.test(v) ? v : null;
}
