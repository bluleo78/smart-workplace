// WP-2105: 모델 출력 파싱 실패를 처리 기록·로그에 사유와 원문 앞부분으로 남긴다.
import { ModelOutputError } from '../agent/provider-error.js';
import { currentAiRunScope, errorMessage, markScopeFailed, swallowRecording, type ModelOutputSnapshot } from './scope.js';

/** 파싱 실패 사유 코드 — 처리 기록 errorReason. */
export const MODEL_OUTPUT_INVALID = 'model_output_invalid';

/** 모델 출력이 JSON 으로 해석되지 않은 오류인지 — ModelOutputError 또는 JSON.parse 의 SyntaxError. */
// 모든 SyntaxError 를 모델 출력 실패로 본다 — 이 실행 경로들에서 JSON.parse 는 모델 출력만 읽기 때문이다.
// (나중에 API 응답 등 다른 JSON.parse 가 같은 경로에 들어오면 잘못 분류되므로 그때 구분이 필요하다.)
export function isModelOutputFailure(e: unknown): boolean {
  return e instanceof ModelOutputError || e instanceof SyntaxError;
}

/**
 * 기록·로그용 상세 문자열. 원문이 있으면 "메시지 / 원문 요약 / 원문 앞부분" 세 줄, 없으면 메시지만.
 * 왜: 파싱이 왜 깨졌는지 모델이 실제로 낸 글을 봐야 알 수 있다.
 */
export function modelOutputFailureDetail(
  message: string,
  out: ModelOutputSnapshot | null,
): string {
  if (!out) return message;
  return `${message}\n[원문 앞부분 ${out.length}자 중 ${out.head.length}자, 텍스트 조각 ${out.chunks}개]\n${out.head}`;
}

/**
 * 파싱 실패면 현재 범위에 실패 사유·상세를 남기고 로그를 찍은 뒤 true. 아니면 아무것도 안 하고 false.
 * 기록 오류는 삼킨다(처리 결과를 바꾸면 안 된다).
 */
export function recordModelOutputFailure(tag: string, e: unknown): boolean {
  if (!isModelOutputFailure(e)) return false;
  const message = errorMessage(e);
  let detail = message;
  swallowRecording('모델 출력 실패 상세', () => {
    detail = modelOutputFailureDetail(message, currentAiRunScope()?.lastOutput ?? null);
  });
  markScopeFailed(MODEL_OUTPUT_INVALID, detail);
  console.error(`[${tag}] 모델 출력 파싱 실패:`, detail);
  return true;
}

/**
 * 라우트 catch 용 — 모델 출력 파싱 실패면 사유·원문과 함께 기록하고, 아니면 일반 실패 로그('[tag] 실패:' + 메시지)만 남긴다.
 * 라우트마다 두 단계를 되풀이하며 메시지를 따로 뽑지 않게 한 곳에 모았다.
 */
export function logRunFailure(tag: string, e: unknown): void {
  if (recordModelOutputFailure(tag, e)) return;
  console.error(`[${tag}] 실패:`, errorMessage(e));
}
