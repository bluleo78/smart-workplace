// WP-1322 스트리밍 실행의 effort 거절 대비 — 가짜 러너로 다시 도는 조건·이벤트 처리·kill 을 확인한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { log } from '../logger.js';
import type { AgentRunner, RunnerInput } from './agent-runner.js';
import { streamWithEffortFallback } from './effort-fallback.js';
import type { RunnerEvent } from './runner-events.js';
import { recordingRunner } from '../ai-run/recording-runner.js';
import { AiRunScope, withAiRunScope } from '../ai-run/scope.js';
import type { AiRunRecord } from '../ai-run/types.js';

const REJECT = new Error("Claude Code returned an error result: API Error: Effort 'max' isn't available with thinking turned off on this model");
const OK: RunnerEvent = { type: 'result', ok: true, text: 'done', usage: null };
const FAIL: RunnerEvent = { type: 'result', ok: false, text: null, usage: null };
const DELTA: RunnerEvent = { type: 'text_delta', text: 'hi', parentToolUseId: null };

/** 실행마다 정해 둔 이벤트를 흘리고 정해 둔 대로 끝나는 가짜 러너 — 받은 입력과 kill 을 기록한다. */
function fakeRunner(runs: { events: RunnerEvent[]; error?: unknown }[]) {
  const inputs: RunnerInput[] = [];
  const kills: ReturnType<typeof vi.fn>[] = [];
  const runner = {
    collect: vi.fn(),
    stream: vi.fn((i: RunnerInput, onEvent: (e: RunnerEvent) => void) => {
      const run = runs[inputs.length];
      inputs.push(i);
      const kill = vi.fn();
      kills.push(kill);
      for (const e of run.events) onEvent(e);
      return { done: run.error ? Promise.reject(run.error) : Promise.resolve(), kill };
    }),
  } as unknown as AgentRunner;
  return { runner, inputs, kills };
}

const input = (over: Partial<RunnerInput> = {}): RunnerInput => ({
  userMessage: 'q',
  systemPrompt: 's',
  model: 'claude-haiku-4-5',
  maxTurns: 5,
  credential: { provider: 'anthropic', token: 't', model: null },
  agentId: 1,
  timeoutMs: 60_000,
  logTag: 't',
  thinkingEffort: 'max',
  ...over,
});

describe('streamWithEffortFallback', () => {
  // 쓰지 않은 mockImplementationOnce 가 다음 테스트로 새지 않게 로그 목을 비운다(WP-2122).
  beforeEach(() => vi.mocked(log.warn).mockReset());

  it('effort 거절이면 effort 없이 한 번 더 돌고, 첫 실행의 실패 result 는 흘리지 않는다', async () => {
    const { runner, inputs } = fakeRunner([{ events: [FAIL], error: REJECT }, { events: [DELTA, OK] }]);
    const got: RunnerEvent[] = [];
    await streamWithEffortFallback(runner, input(), (e) => got.push(e), { logArea: 't' }).done;
    expect(inputs).toHaveLength(2);
    expect(inputs[0].thinkingEffort).toBe('max');
    expect(inputs[1].thinkingEffort).toBeUndefined();
    expect(inputs[1].effort).toBeUndefined();
    expect(inputs[1].timeoutMs).toBeLessThanOrEqual(60_000);
    expect(got).toEqual([DELTA, OK]);
  });

  it('범위 안에서 거절 뒤 재시도가 성공하면 SUCCEEDED 로 기록한다', async () => {
    const records: AiRunRecord[] = [];
    const scope = new AiRunScope({ kind: 'K', tenantId: 1 }, { enqueue: (r) => void records.push(r) });
    // WP-2122: 용서는 실패한 첫 시도의 input 으로 가르므로 실제처럼 recordingRunner 를 거쳐 기록한다.
    const { runner: fake } = fakeRunner([{ events: [FAIL], error: REJECT }, { events: [OK] }]);
    const runner = recordingRunner(fake, 'c');
    await withAiRunScope(scope, () => streamWithEffortFallback(runner, input(), () => undefined, { logArea: 't' }).done);
    scope.close({ ok: true });
    expect(records.at(-1)).toMatchObject({ status: 'SUCCEEDED', errorReason: null });
  });

  // WP-2122: 첫 시도가 거절로 끝나기 전에 같은 범위의 다른 호출이 월 한도로 실패했다면, 재시도 성공이 그 한도 실패까지 지우면 안 된다.
  it('겹친 다른 호출의 한도 실패는 재시도가 성공해도 남아 provider_limit/FAILED 로 기록한다', async () => {
    const LIMIT = new Error("API Error: You've hit your org's monthly spend limit");
    const records: AiRunRecord[] = [];
    const scope = new AiRunScope({ kind: 'K', tenantId: 1 }, { enqueue: (r) => void records.push(r) });
    // 다른 호출 — collect 가 동기로 던져 실패가 그 자리에서 기록된다.
    const other = recordingRunner({ collect: () => { throw LIMIT; }, stream: vi.fn() } as unknown as AgentRunner, 'c');
    let calls = 0;
    const inner = {
      collect: vi.fn(),
      stream: vi.fn((_i: RunnerInput, onEvent: (e: RunnerEvent) => void) => {
        calls += 1;
        if (calls > 1) onEvent(OK); // 재시도는 성공 result 를 낸다
        return calls === 1 ? { done: Promise.reject(REJECT), kill: vi.fn() } : { done: Promise.resolve(), kill: vi.fn() };
      }),
    } as unknown as AgentRunner;
    // 첫 시도의 실패가 기록된 뒤·용서 직전(재시도 경고 로그 시점)에 다른 호출이 한도로 실패한다 — 마지막 실패를 지우는 옛 용서는 이 한도 실패를 지운다.
    let injected = false;
    vi.mocked(log.warn).mockImplementationOnce(() => {
      injected = true;
      void other.collect(input({ userMessage: 'other' })).catch(() => undefined);
    });
    const runner = recordingRunner(inner, 'c');
    await withAiRunScope(scope, () => streamWithEffortFallback(runner, input(), () => undefined, { logArea: 't' }).done);
    scope.close({ ok: true });
    expect(calls).toBe(2);
    // 겹친 호출이 용서 전 시점에 실제로 끼어들었는지 확인 — 로그 위치가 바뀌면 이 시나리오가 무의미해진다.
    expect(injected).toBe(true);
    expect(records.at(-1)).toMatchObject({ status: 'FAILED', errorReason: 'provider_limit' });
  });

  it('거절이 아닌 오류·opencode 연결·effort 미지정·남은 시간 부족이면 다시 돌지 않는다', async () => {
    const cases: [RunnerInput, unknown, (() => number) | undefined][] = [
      [input(), new Error('API Error: Request rejected (429)'), undefined],
      [input({ credential: { provider: 'opencode', payload: { providerId: 'p', options: {} }, model: null } }), REJECT, undefined],
      [input({ thinkingEffort: undefined }), REJECT, undefined],
    ];
    for (const [i, err] of cases) {
      const { runner, inputs } = fakeRunner([{ events: [], error: err }]);
      await expect(streamWithEffortFallback(runner, i, () => {}, { logArea: 't' }).done).rejects.toBe(err);
      expect(inputs).toHaveLength(1);
    }
    let t = 0;
    const now = () => (t += 59_000); // 시작 59초, 실패 시점 118초 → 남은 시간 1초
    const { runner, inputs } = fakeRunner([{ events: [], error: REJECT }]);
    await expect(streamWithEffortFallback(runner, input(), () => {}, { logArea: 't', now }).done).rejects.toBe(REJECT);
    expect(inputs).toHaveLength(1);
  });

  it('보이는 이벤트(텍스트·도구)가 나온 뒤의 거절은 다시 돌지 않고, 모은 이벤트는 순서대로 흘린다', async () => {
    const pre: RunnerEvent = { type: 'assistant_text', text: 'x' };
    const { runner, inputs } = fakeRunner([{ events: [pre, DELTA], error: REJECT }]);
    const got: RunnerEvent[] = [];
    await expect(streamWithEffortFallback(runner, input(), (e) => got.push(e), { logArea: 't' }).done).rejects.toBe(REJECT);
    expect(inputs).toHaveLength(1);
    expect(got).toEqual([pre, DELTA]);
  });

  it('성공하면 모아 둔 이벤트를 끝에 흘린다', async () => {
    const { runner } = fakeRunner([{ events: [OK] }]);
    const got: RunnerEvent[] = [];
    await streamWithEffortFallback(runner, input(), (e) => got.push(e), { logArea: 't' }).done;
    expect(got).toEqual([OK]);
  });

  it('kill 된 뒤의 거절은 다시 돌지 않는다', async () => {
    let rejectFirst: (e: unknown) => void = () => {};
    const kill = vi.fn();
    const runner = {
      collect: vi.fn(),
      stream: vi.fn(() => ({ done: new Promise<void>((_, r) => (rejectFirst = r)), kill })),
    } as unknown as AgentRunner;
    const h = streamWithEffortFallback(runner, input(), () => {}, { logArea: 't' });
    h.kill();
    expect(kill).toHaveBeenCalledTimes(1);
    rejectFirst(REJECT);
    await expect(h.done).rejects.toBe(REJECT);
    expect(runner.stream).toHaveBeenCalledTimes(1);
  });
});
