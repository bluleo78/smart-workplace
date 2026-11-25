import { describe, expect, it, vi } from 'vitest';
import type { AgentRunner, RunnerInput } from '../agent/agent-runner.js';
import type { RunnerEvent } from '../agent/runner-events.js';
import { recordingRunner } from './recording-runner.js';
import { AiRunScope, withAiRunScope } from './scope.js';
import type { AiRunRecord } from './types.js';

const input = { model: 'm-1' } as unknown as RunnerInput;
const resultEv = (ok = true): RunnerEvent => ({
  type: 'result', ok, text: 'x', usage: { inputTokens: 10, outputTokens: 5 },
});

function make() {
  const sink: AiRunRecord[] = [];
  const scope = new AiRunScope({ kind: 'AI_CHAT', tenantId: 1 }, { enqueue: (r) => void sink.push(r) });
  return { sink, scope };
}

// recordingRunner 동작 검증 (WP-1828)
describe('recordingRunner', () => {
  it('범위 밖에서는 inner 결과를 그대로 돌려주고 기록하지 않는다', async () => {
    const events = [resultEv()];
    const inner: AgentRunner = { collect: vi.fn(async () => events), stream: vi.fn() };
    const r = recordingRunner(inner, 'anthropic');
    await expect(r.collect(input)).resolves.toBe(events);
  });

  it('collect: result usage 를 범위에 더한다', async () => {
    const { sink, scope } = make();
    const inner: AgentRunner = { collect: async () => [resultEv()], stream: vi.fn() };
    await withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').collect(input));
    scope.close({ ok: true });
    expect(sink[0]).toMatchObject({ status: 'RUNNING', model: 'm-1', credentialLabel: 'anthropic' });
    expect(sink[1]).toMatchObject({ status: 'SUCCEEDED', inputTokens: 10, outputTokens: 5 });
  });

  it('collect: 최종 텍스트 앞부분과 조각 수를 범위에 남긴다 (WP-2105)', async () => {
    const { scope } = make();
    const events: RunnerEvent[] = [
      { type: 'assistant_text', text: 'first' },
      { type: 'tool_use', id: 't', name: 'n', input: {} } as unknown as RunnerEvent,
      { type: 'assistant_text', text: 'second' },
      { type: 'result', ok: true, text: 'R'.repeat(1200), usage: null },
    ];
    const inner: AgentRunner = { collect: async () => events, stream: vi.fn() };
    await withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').collect(input));
    expect(scope.lastOutput).toEqual({ head: 'R'.repeat(1000), length: 1200, chunks: 2 });
  });

  it('collect: result 이벤트가 없으면 FAILED(no_result)', async () => {
    const { sink, scope } = make();
    const inner: AgentRunner = { collect: async () => [], stream: vi.fn() };
    await withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').collect(input));
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorDetail: 'no_result' });
  });

  it('collect: inner 가 throw 하면 같은 오류를 던지고 범위는 FAILED', async () => {
    const { sink, scope } = make();
    const err = new Error('boom');
    const inner: AgentRunner = { collect: async () => { throw err; }, stream: vi.fn() };
    await expect(withAiRunScope(scope, () => recordingRunner(inner, 'opencode').collect(input))).rejects.toBe(err);
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorDetail: 'boom', credentialLabel: 'opencode' });
  });

  it('stream: onEvent 로 받은 이벤트가 그대로 호출자에게 가고 result usage 가 더해진다', async () => {
    const { sink, scope } = make();
    const kill = vi.fn();
    const inner: AgentRunner = {
      collect: vi.fn(),
      stream: (_i, onEvent) => {
        onEvent({ type: 'text_delta', text: 'a', parentToolUseId: null });
        onEvent(resultEv());
        return { done: Promise.resolve(), kill };
      },
    };
    const got: RunnerEvent[] = [];
    const h = withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').stream(input, (e) => got.push(e)));
    await h.done;
    h.kill();
    expect(got.map((e) => e.type)).toEqual(['text_delta', 'result']);
    expect(kill).toHaveBeenCalledOnce();
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'SUCCEEDED', inputTokens: 10, outputTokens: 5 });
  });

  it('stream: result 없이 done 이 이행되면 FAILED(no_result)', async () => {
    const { sink, scope } = make();
    const inner: AgentRunner = { collect: vi.fn(), stream: () => ({ done: Promise.resolve(), kill: vi.fn() }) };
    const h = withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').stream(input, () => undefined));
    await h.done;
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorDetail: 'no_result' });
  });

  it('stream: done reject 시 같은 오류로 reject, 범위 FAILED', async () => {
    const { sink, scope } = make();
    const err = new Error('stream-boom');
    const inner: AgentRunner = { collect: vi.fn(), stream: () => ({ done: Promise.reject(err), kill: vi.fn() }) };
    const h = withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').stream(input, () => undefined));
    await expect(h.done).rejects.toBe(err);
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorDetail: 'stream-boom' });
  });

  it('범위 메서드가 throw 해도 러너 결과는 같다', async () => {
    const { scope } = make();
    vi.spyOn(scope, 'runnerStarted').mockImplementation(() => { throw new Error('s1'); });
    vi.spyOn(scope, 'runnerFinished').mockImplementation(() => { throw new Error('s2'); });
    const events = [resultEv()];
    const inner: AgentRunner = {
      collect: async () => events,
      stream: (_i, onEvent) => { onEvent(resultEv()); return { done: Promise.resolve(), kill: vi.fn() }; },
    };
    const r = recordingRunner(inner, 'anthropic');
    await expect(withAiRunScope(scope, () => r.collect(input))).resolves.toBe(events);
    const got: RunnerEvent[] = [];
    const h = withAiRunScope(scope, () => r.stream(input, (e) => got.push(e)));
    await expect(h.done).resolves.toBeUndefined();
    expect(got).toHaveLength(1);
  });

  it('stream: result 뒤에 done 이 reject 돼도 usage 는 보존한다', async () => {
    const { sink, scope } = make();
    const err = new Error('late');
    const inner: AgentRunner = {
      collect: vi.fn(),
      stream: (_i, onEvent) => { onEvent(resultEv()); return { done: Promise.reject(err), kill: vi.fn() }; },
    };
    const h = withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').stream(input, () => undefined));
    await expect(h.done).rejects.toBe(err);
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', inputTokens: 10, outputTokens: 5 });
  });

  it('collect: result ok:false 면 범위 FAILED', async () => {
    const { sink, scope } = make();
    const inner: AgentRunner = { collect: async () => [resultEv(false)], stream: vi.fn() };
    await withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').collect(input));
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', inputTokens: 10 });
  });

  it('stream: result ok:false 면 범위 FAILED', async () => {
    const { sink, scope } = make();
    const inner: AgentRunner = {
      collect: vi.fn(),
      stream: (_i, onEvent) => { onEvent(resultEv(false)); return { done: Promise.resolve(), kill: vi.fn() }; },
    };
    const h = withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').stream(input, () => undefined));
    await h.done;
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', inputTokens: 10 });
  });

  it('stream: inner.stream 이 동기 throw 하면 FAILED 기록 후 같은 오류를 던진다', () => {
    const { sink, scope } = make();
    const err = new Error('sync-boom');
    const inner: AgentRunner = { collect: vi.fn(), stream: () => { throw err; } };
    expect(() => withAiRunScope(scope, () => recordingRunner(inner, 'anthropic').stream(input, () => undefined))).toThrow(err);
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorDetail: 'sync-boom' });
  });
});
