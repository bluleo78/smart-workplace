// WP-1322: 스트리밍 실행의 effort 거절 대비 — 비서 「생각의 깊이」를 Claude SDK effort 로 싣는데, 그 단계를 받지 않는 모델이면
// SDK 가 요청을 거절하고 throw 한다(WP-139 실측: `Claude Code returned an error result: API Error: Effort '…' isn't available with
// thinking turned off on this model`). 단발 실행(single-shot.ts)은 이미 effort 없이 한 번 더 도는데, 스트리밍 실행(AI 채팅·노트 작성)도
// 같은 거절이면 같은 방식으로 한 번 더 돌게 한다 — 사용자가 고른 깊이 때문에 대화가 아예 실패하지 않게.
//
// 다시 도는 조건: 단발과 같은 규칙(single-shot.shouldRetryWithoutEffort) + 아직 사용자에게 보인 것이 없음(텍스트·도구 이벤트 전) +
// kill 되지 않음. 보인 것이 생긴 뒤의 실패는 다시 돌면 답이 겹치므로 그대로 실패시킨다.
// 첫 실행의 이벤트는 처음 보이는 이벤트가 나올 때까지 모아 두었다가 그때 흘려보낸다 — 거절로 끝나면 버려서 실패 result·오류 문장이
// 다시 돈 실행의 결과와 섞이지 않게 한다.
import { log } from '../logger.js';
import type { AgentRunner, RunnerInput, RunnerStreamHandle } from './agent-runner.js';
import type { RunnerEvent } from './runner-events.js';
import { shouldRetryWithoutEffort, withoutEffort } from './single-shot.js';

/** 사용자에게 보이는(또는 부작용이 생긴) 이벤트 — 이것이 나온 뒤에는 다시 돌지 않는다. */
const isVisible = (e: RunnerEvent) => e.type === 'text_delta' || e.type === 'tool_use' || e.type === 'tool_done';

export interface EffortFallbackOptions {
  /** 로그 영역(예: 'ai-chat', 'wiki-compose'). */
  logArea: string;
  /** 남은 시간 계산용 시계 — 테스트가 갈아 끼운다. */
  now?: () => number;
}

/**
 * runner.stream 과 같은 계약 — effort 거절이면 effort 없이 한 번 더 돈다. kill 은 지금 도는 실행을 멈추고, 이후 다시 돌지 않게 한다.
 */
export function streamWithEffortFallback(
  runner: AgentRunner,
  input: RunnerInput,
  onEvent: (e: RunnerEvent) => void,
  opts: EffortFallbackOptions,
): RunnerStreamHandle {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  let killed = false;
  let current: RunnerStreamHandle;

  // 첫 실행 — 보이는 이벤트가 나올 때까지 모은다.
  let buffering = true;
  const buffered: RunnerEvent[] = [];
  const flush = () => {
    buffering = false;
    for (const e of buffered.splice(0)) onEvent(e);
  };
  current = runner.stream(input, (e) => {
    if (!buffering) return onEvent(e);
    if (isVisible(e)) {
      flush();
      onEvent(e);
    } else buffered.push(e);
  });

  const done = (async () => {
    try {
      await current.done;
      flush();
    } catch (e) {
      const remainingMs = input.timeoutMs - (now() - startedAt);
      if (!buffering || killed || !shouldRetryWithoutEffort(input, e, remainingMs)) {
        flush();
        throw e;
      }
      // 첫 실행의 모은 이벤트(실패 result 등)는 버린다.
      buffered.length = 0;
      buffering = false;
      log.warn(opts.logArea, 'retry_without_effort', {
        requestId: input.requestId,
        model: input.model,
        effort: input.effort ?? input.thinkingEffort,
        remainingMs,
        error: e instanceof Error ? e.message : String(e),
      });
      current = runner.stream(withoutEffort(input, remainingMs), onEvent);
      await current.done;
    }
  })();

  return {
    done,
    kill: () => {
      killed = true;
      current.kill();
    },
  };
}
