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

/** 값이 undefined 인 키를 뺀다 — derived 가 헤더 값을 undefined 로 지우지 않게 한다. */
function definedOnly(o: Partial<AiRunContext>): Partial<AiRunContext> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<AiRunContext>;
}

/**
 * 헤더·표 값·요청에서 뽑은 값을 합쳐 범위를 연다(WP-1828) — 미들웨어와 이벤트 라우트가 함께 쓴다.
 * 필드 우선순위는 기본 헤더 > derived, kind 는 헤더 > 표 값(kind).
 * 단 opts.derivedWins 면 derived 에 정의된 필드가 헤더보다 앞선다(derived 의 undefined 는 헤더를 지우지 않는다) — 이벤트 payload 가
 * 권위 있는 이벤트 라우트(recurring tenantId·actor·sourceAt 등)에서 발행 스레드의 헤더 값이 payload 를 덮지 않게 한다. 미들웨어는 헤더 우선 그대로. 열다가 던지면 경고만 하고 undefined(기록 없이 처리).
 */
export function openAiRunScope(
  kind: string,
  headerRaw: string | string[] | undefined,
  derived: Partial<AiRunContext>,
  sink: AiRunSink,
  opts?: { derivedWins?: boolean },
): AiRunScope | undefined {
  try {
    const header = readAiRunHeader(headerRaw);
    const base = opts?.derivedWins ? { ...header, ...definedOnly(derived) } : { ...derived, ...header };
    const merged: AiRunContext & { kind: string } = { ...base, kind: header.kind ?? kind };
    return new AiRunScope(merged, sink);
  } catch (e) {
    console.warn('[ai-run] 범위 열기 실패(무시):', errorMessage(e));
    return undefined;
  }
}

/** 범위를 닫되 기록 쪽 오류는 삼킨다 — 기록이 처리 결과를 바꾸면 안 된다. */
export function safeClose(scope: AiRunScope, outcome: { ok: boolean; reason?: string; detail?: string }): void {
  swallowRecording('범위 닫기', () => scope.close(outcome));
}
