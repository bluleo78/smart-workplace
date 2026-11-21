import { extractApiErrorCode, isConflictError } from './api-error'

/**
 * 일정 저장이 「다른 사람이 먼저 고쳐서」 막힌 충돌(409 + errors.code=EVENT_CONFLICT)인가 (WP-1920).
 * 같은 409 라도 다른 사유(코드 없음·다른 코드)는 충돌이 아니므로 상태와 코드를 함께 본다.
 * 훅(토스트·목록 갱신)과 화면(대화상자 닫기)이 같은 판정을 쓰도록 한 곳에 둔다.
 */
export function isEventConflict(error: unknown): boolean {
  return isConflictError(error) && extractApiErrorCode(error) === 'EVENT_CONFLICT'
}
