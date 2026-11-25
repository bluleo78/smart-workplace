import type { AgentRunner, RunnerInput, RunnerStreamHandle } from '../agent/agent-runner.js';
import { answerChunks, finalText, type RunnerEvent } from '../agent/runner-events.js';
import type { RunnerUsage } from '../agent/runner-events.js';
import { currentAiRunScope, swallowRecording, type AiRunScope } from './scope.js';

/** 범위 호출을 안전하게 감싼다 — 기록 오류가 러너 결과를 바꾸면 안 된다. */
const safe = (fn: () => void): void => swallowRecording('범위 기록', fn);

/** 범위에 보고할 result 이벤트의 일부 — 전체 이벤트를 붙들지 않는다(WP-1828). */
type ResultSummary = { ok: boolean; usage: RunnerUsage | null };

/** result 이벤트를 범위에 보고한다. 없으면 no_result 실패로 본다. startSeq 는 이 호출의 시작 순번(우회 판정용, WP-2106). */
function reportResult(scope: AiRunScope, result: ResultSummary | undefined, startSeq: number | undefined): void {
  if (result) safe(() => scope.runnerFinished({ ...result, startSeq }));
  else safe(() => scope.runnerFinished({ ok: false, usage: null, error: new Error('no_result'), startSeq }));
}

/** 범위에 러너 시작을 알리고 그 순번을 돌려준다 — 기록이 실패하면 undefined(WP-2106: 성공이 어느 실패를 우회했는지 가르는 데 쓴다). */
function start(scope: AiRunScope, model: string, credentialLabel: string): number | undefined {
  let startSeq: number | undefined;
  safe(() => {
    startSeq = scope.runnerStarted(model, credentialLabel);
  });
  return startSeq;
}

/**
 * 러너를 감싸 현재 AI 처리 범위에 시작·사용량·결과를 모은다 (WP-1828).
 * 범위는 호출 시점에 잡아 늦게 오는 이벤트도 올바른 범위로 가게 한다. 범위가 없으면 inner 를 그대로 부른다.
 * 러너의 결과·이벤트·rejection·kill 동작은 바꾸지 않는다.
 */
export function recordingRunner(inner: AgentRunner, credentialLabel: string): AgentRunner {
  return {
    stream(i: RunnerInput, onEvent: (e: RunnerEvent) => void): RunnerStreamHandle {
      const scope = currentAiRunScope();
      if (!scope) return inner.stream(i, onEvent);
      const startSeq = start(scope, i.model, credentialLabel);
      let result: ResultSummary | undefined;
      let handle: RunnerStreamHandle;
      try {
        handle = inner.stream(i, (e) => {
          if (e.type === 'result') result = { ok: e.ok, usage: e.usage };
          onEvent(e);
        });
      } catch (err) {
        // 동기 throw 도 실패로 기록하고 같은 오류를 다시 던진다.
        safe(() => scope.runnerFinished({ ok: false, usage: null, error: err, startSeq }));
        throw err;
      }
      const done = handle.done.then(
        () => reportResult(scope, result, startSeq),
        (err: unknown) => {
          safe(() => scope.runnerFinished({ ok: false, usage: result?.usage ?? null, error: err, startSeq }));
          throw err;
        },
      );
      return { done, kill: handle.kill };
    },

    async collect(i: RunnerInput): Promise<RunnerEvent[]> {
      const scope = currentAiRunScope();
      if (!scope) return inner.collect(i);
      const startSeq = start(scope, i.model, credentialLabel);
      let events: RunnerEvent[];
      try {
        events = await inner.collect(i);
      } catch (err) {
        safe(() => scope.runnerFinished({ ok: false, usage: null, error: err, startSeq }));
        throw err;
      }
      const result = events.find((e): e is Extract<RunnerEvent, { type: 'result' }> => e.type === 'result');
      reportResult(scope, result, startSeq);
      // 파싱 실패 진단용으로 최종 텍스트 앞부분을 남긴다(WP-2105).
      safe(() => scope.noteOutput(finalText(events), answerChunks(events).length));
      return events;
    },
  };
}
