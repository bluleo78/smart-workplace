// 도구 없는 단발 실행(maxTurns 1) + effort 거절이면 한 번 더 — WP-139 run-suggestions 에서 옮겨 WP-385 메모리 정리·WP-386 공용 추출이 함께 쓴다.
// effort 를 받지 않는 모델이면 요청이 거절(4xx)될 수 있어, Claude 연결은 그런 거절일 때만 남은 시간 안에서 effort 없이 한 번 다시 돈다.
import { log } from '../logger.js';
import { runnerFor, type RunnerInput } from './agent-runner.js';
import { resultOk, type RunnerEvent } from './runner-events.js';

/** effort 없이 다시 돌 최소 남은 시간 — 이보다 짧으면 단발 생성도 끝내기 어려워 재시도하지 않는다. */
export const RETRY_MIN_REMAINING_MS = 2_000;

export interface SingleShotOptions {
  /** 요청 시작 시각(Date.now) — 남은 시간은 여기서부터 재서 다시 돌아도 input.timeoutMs 를 넘지 않는다. */
  startedAt: number;
  /** 로그 영역(예: 'suggestions', 'memory-cleanup'). */
  logArea: string;
  /** 실패 result(ok:false·result 없음)일 때 던질 메시지. */
  failMessage: string;
  /** 재시도 경고 로그에 덧붙일 필드(사용자 내용은 넣지 않는다). */
  logFields: Record<string, unknown>;
}

/**
 * effort 미지원으로 볼 만한 실패인가 — 요청 거절(4xx, 429 제외)이거나 effort 를 언급하는 API 오류일 때만 true.
 * 근거(claude-agent-sdk 0.3.284 실측): 러너(runSdkCollect)는 api_error_status 같은 구조화 정보를 넘기지 않고, SDK 가 오류 result 뒤에
 * `Claude Code returned an error result: <result 텍스트>` 로 throw 한다. 그 텍스트는 CLI 가 만든 `API Error: <상태> …` 이고
 * 429 는 `API Error: Request rejected (429) · …`, thinking 꺼진 모델의 effort 거절은 상태 없이 `API Error: Effort '…' isn't available…` 이다.
 * 429·5xx·시간 초과·result 없음·그 밖의 예외는 effort 를 빼도 나아지지 않으므로 다시 돌지 않는다.
 */
export function looksLikeEffortRejection(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  if (!message.includes('API Error')) return false;
  const status = /API Error: (\d{3})\b/.exec(message)?.[1];
  if (status) return status.startsWith('4') && status !== '429';
  return /effort/i.test(message);
}

/** 한 번 실행 — 실패(러너 예외·실패 result)는 throw. 실패 실행의 부분 텍스트는 쓰지 않는다. */
async function collectOk(input: RunnerInput, failMessage: string): Promise<RunnerEvent[]> {
  const events = await runnerFor(input.credential).collect(input);
  if (!resultOk(events)) throw new Error(failMessage);
  return events;
}

/** 단발 실행 — 성공 이벤트를 돌려주고, 실패는 throw(호출자 라우트가 502 로 바꾼다). */
export async function runSingleShot(input: RunnerInput, opts: SingleShotOptions): Promise<RunnerEvent[]> {
  try {
    return await collectOk(input, opts.failMessage);
  } catch (e) {
    // opencode 러너는 effort 를 쓰지 않아 같은 실행을 반복할 뿐이므로 다시 돌지 않는다.
    const remainingMs = input.timeoutMs - (Date.now() - opts.startedAt);
    if (input.credential.provider !== 'anthropic' || !looksLikeEffortRejection(e) || remainingMs < RETRY_MIN_REMAINING_MS) throw e;
    log.warn(opts.logArea, 'retry_without_effort', {
      requestId: input.requestId, ...opts.logFields, model: input.model, remainingMs,
      error: e instanceof Error ? e.message : String(e),
    });
    return collectOk({ ...input, effort: undefined, timeoutMs: remainingMs }, opts.failMessage);
  }
}
