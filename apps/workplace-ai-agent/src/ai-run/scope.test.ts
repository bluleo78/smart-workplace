import { describe, expect, it, vi } from 'vitest';
import { AiRunScope, currentAiRunScope, withAiRunScope } from './scope.js';
import type { AiRunRecord } from './types.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function make(extra: Record<string, unknown> = {}) {
  const sink: AiRunRecord[] = [];
  const scope = new AiRunScope({ kind: 'AI_CHAT', tenantId: 1, ...extra }, { enqueue: (r) => void sink.push(r) }, () => NOW);
  return { sink, scope };
}

// AiRunScope 동작 검증 (WP-1828)
describe('AiRunScope', () => {
  // WP-2105: 모델 출력 원문 기억·강제 실패 사유
  it('noteOutput 뒤 markFailed 하고 close 하면 사유·상세가 기록된다', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: true, usage: null });
    scope.noteOutput('abc', 1);
    scope.markFailed('model_output_invalid', 'd');
    scope.close({ ok: false });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorReason: 'model_output_invalid', errorDetail: 'd' });
  });

  it('러너 실패 뒤 markFailed 해도 사유는 runner_error', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: false, usage: null, error: new Error('x') });
    scope.markFailed('model_output_invalid', 'd');
    scope.close({ ok: false });
    expect(sink[1]).toMatchObject({ errorReason: 'runner_error' });
  });

  it('noteOutput 은 앞 1000자와 전체 길이를 기억한다', () => {
    const { scope } = make();
    expect(scope.lastOutput).toBeNull();
    scope.noteOutput('a'.repeat(1500), 3);
    expect(scope.lastOutput).toEqual({ head: 'a'.repeat(1000), length: 1500, chunks: 3 });
  });

  it('hasForcedFailure 는 markFailed 뒤에만 true', () => {
    const { scope } = make();
    expect(scope.hasForcedFailure).toBe(false);
    scope.markFailed('r');
    expect(scope.hasForcedFailure).toBe(true);
  });

  it('runner 없이 close 하면 아무것도 넣지 않는다', () => {
    const { sink, scope } = make();
    scope.close({ ok: true });
    expect(sink).toHaveLength(0);
  });

  it('첫 runnerStarted 때 RUNNING 한 건, 두 번째 호출은 더 넣지 않는다', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m1', 'cred');
    scope.runnerStarted('m2', 'cred');
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ status: 'RUNNING', startedAt: NOW.toISOString(), endedAt: null, attempt: 1, kind: 'AI_CHAT', tenantId: 1 });
  });

  it('두 번 호출한 usage 를 합치고 모델은 마지막 값', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m1', 'cred');
    scope.runnerFinished({ ok: true, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7 } });
    scope.runnerStarted('m2', 'cred');
    scope.runnerFinished({ ok: true, usage: { inputTokens: 1, outputTokens: 2 } });
    scope.close({ ok: true });
    expect(sink).toHaveLength(2);
    expect(sink[1]).toMatchObject({
      status: 'SUCCEEDED', inputTokens: 11, outputTokens: 7, cacheReadTokens: 7, cacheWriteTokens: null,
      model: 'm2', credentialLabel: 'cred', errorReason: null,
    });
  });

  it('러너 하나라도 실패면 FAILED·runner_error, detail 은 오류 메시지 2000자 자름', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: false, usage: null, error: new Error('x'.repeat(3000)) });
    scope.close({ ok: true });
    expect(sink[1].status).toBe('FAILED');
    expect(sink[1].errorReason).toBe('runner_error');
    expect(sink[1].errorDetail).toHaveLength(2000);
    expect(sink[1].inputTokens).toBeNull();
  });

  it('close 사유가 우선한다', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.close({ ok: false, reason: 'http_500', detail: 'boom' });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorReason: 'http_500', errorDetail: 'boom' });
  });

  it('close 두 번 불러도 한 건', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.close({ ok: true });
    scope.close({ ok: false });
    expect(sink.filter((r) => r.status !== 'RUNNING')).toHaveLength(1);
  });

  it('withAiRunScope 안 async 경계 뒤에도 currentAiRunScope 가 같은 범위, close 뒤에는 undefined', async () => {
    const { scope } = make();
    await withAiRunScope(scope, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentAiRunScope()).toBe(scope);
      scope.close({ ok: true });
      expect(currentAiRunScope()).toBeUndefined();
    });
    expect(currentAiRunScope()).toBeUndefined();
  });

  it('sink.enqueue 가 throw 해도 close 가 throw 하지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const scope = new AiRunScope({ kind: 'K' }, { enqueue: () => { throw new Error('boom'); } }, () => NOW);
      expect(() => {
        scope.runnerStarted('m', 'c');
        scope.close({ ok: true });
      }).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('유한수가 아닌 토큰 값은 합에서 건너뛴다', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: true, usage: { inputTokens: Number.NaN, outputTokens: 4, cacheReadTokens: Infinity } });
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ inputTokens: null, outputTokens: 4, cacheReadTokens: null });
  });

  it('러너 실패 뒤 forgiveRunnerFailure 하고 재시도가 성공하면 SUCCEEDED, 토큰은 합쳐 둔다', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: false, usage: { inputTokens: 3, outputTokens: 0 }, error: new Error('effort') });
    scope.forgiveRunnerFailure();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: true, usage: { inputTokens: 4, outputTokens: 0 } });
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'SUCCEEDED', errorReason: null, errorDetail: null, inputTokens: 7 });
  });

  it('forgive 는 마지막 실패 하나만 지운다 — 앞선 실패가 남으면 FAILED, 사유는 남은 가장 최근 것', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: false, usage: null, error: new Error('A') });
    scope.runnerFinished({ ok: false, usage: null, error: new Error('B') });
    scope.forgiveRunnerFailure();
    scope.runnerFinished({ ok: true, usage: null });
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorReason: 'runner_error', errorDetail: 'A' });
  });

  it('markFailed 하면 close(ok) 도 FAILED 와 그 사유로 기록한다', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: true, usage: null });
    scope.markFailed('stream_error', 'boom');
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorReason: 'stream_error', errorDetail: 'boom' });
  });

  // 러너가 실패했으면 SSE 라우트의 stream_error 가 그 사유를 덮지 않는다.
  it('러너 실패 + markFailed(stream_error) 면 사유는 runner_error, 상세는 러너 오류', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: false, usage: null, error: new Error('provider 401') });
    scope.markFailed('stream_error', 'sse broke');
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorReason: 'runner_error', errorDetail: 'provider 401' });
  });

  it('러너 성공 + markFailed 면 stream_error', () => {
    const { sink, scope } = make();
    scope.runnerStarted('m', 'c');
    scope.runnerFinished({ ok: true, usage: null });
    scope.markFailed('stream_error', 'sse broke');
    scope.close({ ok: true });
    expect(sink[1]).toMatchObject({ status: 'FAILED', errorReason: 'stream_error', errorDetail: 'sse broke' });
  });
});
