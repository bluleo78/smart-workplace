// AI 처리 실패 사유 코드 → 화면 이름(WP-2106) — 서버가 error_reason 에 남기는 원인 코드를 관리자가 읽는 한글로 옮긴다.
// 모르는 코드는 코드 그대로 보여 새 사유가 생겨도 화면이 깨지지 않게 하고, 사유가 비어 있으면 그냥 「실패」 로 쓴다.

/** 사유 코드별 화면 이름 — AI 서버(원인 코드)와 API(503·타임아웃 등)가 남기는 코드를 모두 담는다. */
export const AI_RUN_REASON_LABELS: Record<string, string> = {
  provider_limit: '사용 한도 초과',
  provider_auth: '계정 인증 실패',
  provider_rate: '요청 속도 제한',
  provider_overloaded: '모델 서버 과부하',
  provider_error: '모델 서버 오류',
  runner_unavailable: '실행기 사용 불가',
  model_not_found: '모델 없음',
  timeout: '시간 초과',
  model_output_invalid: '출력 형식 오류',
  agent_timeout: 'AI 서버 응답 시간 초과',
  agent_unreachable: 'AI 서버 연결 실패',
  client_closed: '요청 취소',
  runner_error: '실행 오류',
  failed: '실패',
}

/** AI 서버가 돌려준 HTTP 상태 사유(http_502 등) — 숫자를 뽑아 「AI 서버 오류(502)」 로 쓴다. */
const HTTP_REASON = /^http_(\d+)$/

/** 실패 사유 코드 → 화면 이름. 비어 있으면 「실패」, 모르는 코드는 코드 그대로. */
export function aiRunReasonLabel(code: string | null | undefined): string {
  if (code == null || code.trim() === '') return '실패'
  const http = HTTP_REASON.exec(code)
  if (http) return `AI 서버 오류(${http[1]})`
  return AI_RUN_REASON_LABELS[code] ?? code
}
