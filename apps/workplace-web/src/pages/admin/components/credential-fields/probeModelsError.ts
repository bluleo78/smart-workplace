import { apiErrorResponse, extractApiError } from '@/lib/api-error';

/** 모델 프로브 실패 안내 — 목록 대신 직접 입력 칸으로 넘어간다는 뜻을 함께 전한다. */
const PROBE_MODELS_FALLBACK = '모델 목록을 불러오지 못했습니다. 모델 id를 직접 입력하세요.';

/**
 * 「모델 불러오기」 실패를 사용자 문구로 — 개인 비서 설정·관리자 AI 연결 대화상자가 함께 쓴다(WP-1884).
 * 서버 응답이 있으면 공용 규칙(extractApiError — 필드 검증 문구 우선, 5xx 한글 없는 내부 문구는 안내로)을 따르고,
 * 응답이 없으면(네트워크 등) 안내만 보인다 — extractApiError 의 네트워크 안내를 덧붙이면 마침표로 끝나는 이 안내와 문장이 겹친다.
 */
export function probeModelsErrorMessage(error: unknown): string {
  return apiErrorResponse(error) ? extractApiError(error, PROBE_MODELS_FALLBACK) : PROBE_MODELS_FALLBACK;
}
