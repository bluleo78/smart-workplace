// WP-1322 스트리밍 실행의 effort 거절 대비 — 가짜 러너로 다시 도는 조건·이벤트 처리·kill 을 확인한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { AgentRunner, RunnerInput } from './agent-runner.js';
import { streamWithEffortFallback } from './effort-fallback.js';
import type { RunnerEvent } from './runner-events.js';

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
