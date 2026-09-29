// WP-48 SSO 로그인 공용 유틸 — start 링크, 오류 코드 → 배너 문구, returnTo 정제.

export const SSO_START_PATH = '/api/v1/auth/sso/start'

/** Microsoft 로그인 시작 링크. 브라우저 전체 이동으로 호출한다(서버가 302 로 Microsoft 로 보낸다). */
export function ssoStartHref(returnTo: string): string {
  return `${SSO_START_PATH}?returnTo=${encodeURIComponent(returnTo)}`
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: '등록되지 않은 Microsoft 계정입니다. 관리자에게 등록을 요청하세요.',
  consent: '조직 관리자의 앱 승인이 필요합니다.',
  retry: '로그인 처리 중 문제가 발생했습니다. 다시 시도해 주세요.',
}

/** 서버가 붙인 sso_error 코드 → 배너 문구. 모르는 코드(unavailable 포함)는 null — 배너를 띄우지 않는다. */
export function ssoErrorMessage(code: string | null): string | null {
  return code ? (ERROR_MESSAGES[code] ?? null) : null
}

/** same-origin 상대경로만 통과(서버 ReturnToSanitizer 와 같은 규칙) — 클라이언트에서도 한 번 더 막는다. */
export function safeReturnTo(raw: string | null): string {
  if (!raw) return '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return '/'
  }
  const ok = (p: string) =>
    // eslint-disable-next-line no-control-regex
    p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && !/[\u0000-\u001f\u007f]/.test(p)
  return ok(raw) && ok(decoded) ? raw : '/'
}
