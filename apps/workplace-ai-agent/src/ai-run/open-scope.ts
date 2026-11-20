// WP-1828: 요청 미들웨어와 이벤트 라우트가 함께 쓰는 범위 열기·닫기 보조 함수.
import { parseAiRunHeader } from './header.js';
import { AiRunScope, errorMessage, swallowRecording } from './scope.js';
import type { AiRunContext, AiRunSink } from './types.js';

/**
 * X-AI-Run 헤더 원값을 해석한다. 배열 헤더는 첫 원소만 쓴다.
 * 값이 있는데 읽을 수 없으면 한 줄만 경고하고(값은 100자까지) 빈 맥락을 돌려준다 — 없는 헤더처럼 본다.
 */
export function readAiRunHeader(raw: string | string[] | undefined): AiRunContext {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const parsed = parseAiRunHeader(first);
  if (!parsed && first) console.warn('[ai-run] X-AI-Run 헤더를 읽을 수 없어 무시한다:', first.slice(0, 100));
  return parsed ?? {};
}

/**
 * 헤더·표 값·요청에서 뽑은 값을 합쳐 범위를 연다(WP-1828) — 미들웨어와 이벤트 라우트가 함께 쓴다.
 * 필드 우선순위는 헤더 > derived, kind 는 헤더 > 표 값(kind). 열다가 던지면 경고만 하고 undefined(기록 없이 처리).
 */
export function openAiRunScope(
  kind: string,
  headerRaw: string | string[] | undefined,
  derived: Partial<AiRunContext>,
  sink: AiRunSink,
): AiRunScope | undefined {
  try {
    const header = readAiRunHeader(headerRaw);
    return new AiRunScope({ ...derived, ...header, kind: header.kind ?? kind }, sink);
  } catch (e) {
    console.warn('[ai-run] 범위 열기 실패(무시):', errorMessage(e));
    return undefined;
  }
}

/** 범위를 닫되 기록 쪽 오류는 삼킨다 — 기록이 처리 결과를 바꾸면 안 된다. */
export function safeClose(scope: AiRunScope, outcome: { ok: boolean; reason?: string; detail?: string }): void {
  swallowRecording('범위 닫기', () => scope.close(outcome));
}
