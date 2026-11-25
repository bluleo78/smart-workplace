import { classifyProviderError, isModelNotFoundError } from '../agent/provider-error.js';
import { RunnerLimitError } from '../agent/runner-limit.js';

/** 처리 기록(ai_run)의 원인별 실패 사유 코드 (WP-2106). 관리 화면이 이 코드로 사유별 집계·문구를 보여 준다. */
export type AiRunFailureReason =
  | 'provider_limit'
  | 'provider_auth'
  | 'provider_rate'
  | 'provider_overloaded'
  | 'provider_error'
  | 'runner_unavailable'
  | 'model_not_found'
  | 'timeout';

/**
 * 러너 오류를 원인 코드로 분류한다. 분류할 수 없으면 null — 호출자가 http_<코드>·runner_error 로 폴백한다.
 * 모델 없음은 404 문구라 제공자 판정(상태 코드 매핑)보다 먼저 본다.
 */
export function failureReasonOf(err: unknown): AiRunFailureReason | null {
  if (err instanceof RunnerLimitError) return err.kind === 'timeout' ? 'timeout' : null;
  if (isModelNotFoundError(err)) return 'model_not_found';
  const r = classifyProviderError(err);
  return r === null ? null : (r.toLowerCase() as AiRunFailureReason);
}
