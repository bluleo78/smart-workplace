import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunnerInput } from './agent-runner.js';

const { collectSpy, logMock } = vi.hoisted(() => ({
  collectSpy: vi.fn(),
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./agent-runner.js', () => ({ runnerFor: vi.fn(() => ({ collect: collectSpy, stream: vi.fn() })) }));
vi.mock('../logger.js', () => ({ log: logMock }));

import { looksLikeEffortRejection, runSingleShot } from './single-shot.js';

const NOW = new Date('2026-10-15T00:00:00Z');
const anthropic = { provider: 'anthropic' as const, token: 'tok', model: null };
const opencode = { provider: 'opencode' as const, payload: { providerId: 'p', options: {} }, model: 'p/m' };
const ok = [{ type: 'result', ok: true, text: '{"ops":[]}', usage: null }];
const EFFORT_400 =
  'Claude Code returned an error result: API Error: 400 {"type":"error","error":{"message":"effort not supported"}}';

const input = (credential: RunnerInput['credential'] = anthropic): RunnerInput =>
  ({
    userMessage: 'u',
    systemPrompt: 's',
    model: 'claude-haiku-5-5',
    maxTurns: 1,
    credential,
    agentId: 7,
    timeoutMs: 30_000,
    logTag: 't',
    requestId: 'r1',
    includePartialMessages: false,
    allowSubagents: false,
    allowFileRead: false,
    effort: 'low',
  }) as RunnerInput;
const opts = { startedAt: NOW.getTime(), logArea: 'memory-cleanup', failMessage: '메모리 정리 실행 실패', logFields: { agentId: 7 } };
const failAfter = (ms: number, message = EFFORT_400) => async () => {
  vi.setSystemTime(Date.now() + ms);
  throw new Error(message);
};

beforeEach(() => {
  vi.clearAllMocks();
  collectSpy.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('runSingleShot', () => {
  it('성공이면 이벤트를 그대로 돌려준다', async () => {
    collectSpy.mockResolvedValue(ok);
    await expect(runSingleShot(input(), opts)).resolves.toEqual(ok);
    expect(collectSpy).toHaveBeenCalledTimes(1);
  });
  it('실패 result 는 failMessage 로 던지고 다시 돌지 않는다', async () => {
    collectSpy.mockResolvedValue([{ type: 'result', ok: false, text: '부분', usage: null }]);
    await expect(runSingleShot(input(), opts)).rejects.toThrow('메모리 정리 실행 실패');
    expect(collectSpy).toHaveBeenCalledTimes(1);
  });
  it('effort 거절이면 남은 시간으로 effort 없이 한 번 더 돌고 logArea 로 경고를 남긴다', async () => {
    collectSpy.mockImplementationOnce(failAfter(5_000)).mockResolvedValueOnce(ok);
    await expect(runSingleShot(input(), opts)).resolves.toEqual(ok);
    const retry = collectSpy.mock.calls[1][0] as RunnerInput;
    expect(retry.effort).toBeUndefined();
    expect(retry.timeoutMs).toBe(25_000);
    expect(logMock.warn).toHaveBeenCalledWith('memory-cleanup', 'retry_without_effort', expect.objectContaining({ agentId: 7, requestId: 'r1' }));
  });
  it('opencode 연결이나 남은 시간 2초 미만이면 다시 돌지 않는다', async () => {
    collectSpy.mockImplementation(failAfter(1_000));
    await expect(runSingleShot(input(opencode), opts)).rejects.toThrow('API Error: 400');
    collectSpy.mockReset();
    collectSpy.mockImplementation(failAfter(28_500));
    await expect(runSingleShot(input(), { ...opts, startedAt: Date.now() })).rejects.toThrow('API Error: 400');
    expect(collectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('looksLikeEffortRejection', () => {
  it('4xx(429 제외)·effort 언급만 거절로 본다', () => {
    expect(looksLikeEffortRejection(new Error(EFFORT_400))).toBe(true);
    expect(looksLikeEffortRejection(new Error("API Error: Effort 'low' isn't available"))).toBe(true);
    expect(looksLikeEffortRejection(new Error('API Error: Request rejected (429)'))).toBe(false);
    expect(looksLikeEffortRejection(new Error('API Error: 500 {}'))).toBe(false);
    expect(looksLikeEffortRejection(new Error('timeout after 1000ms'))).toBe(false);
  });
});
