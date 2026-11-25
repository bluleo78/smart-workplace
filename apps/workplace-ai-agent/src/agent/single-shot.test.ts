import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runnerFor, type RunnerInput } from './agent-runner.js';

const { collectSpy, logMock } = vi.hoisted(() => ({
  collectSpy: vi.fn(),
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./agent-runner.js', () => ({ runnerFor: vi.fn(() => ({ collect: collectSpy, stream: vi.fn() })) }));
vi.mock('../logger.js', () => ({ log: logMock }));

import { recordingRunner } from '../ai-run/recording-runner.js';
import { AiRunScope, withAiRunScope } from '../ai-run/scope.js';
import type { AiRunRecord } from '../ai-run/types.js';
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
  // 겹친 호출 테스트가 바꾼 runnerFor 반환값을 기본 목으로 되돌린다 — 뒤 테스트가 감싼 러너를 물려받지 않게(WP-2122).
  vi.mocked(runnerFor).mockImplementation(() => ({ collect: collectSpy, stream: vi.fn() }) as never);
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
  it('범위 안에서 effort 거절 뒤 재시도가 성공하면 SUCCEEDED 로 기록한다', async () => {
    const records: AiRunRecord[] = [];
    const scope = new AiRunScope({ kind: 'K', tenantId: 1 }, { enqueue: (r) => void records.push(r) });
    // WP-2122: 용서는 실패한 첫 시도의 input 으로 가르므로 실제처럼 recordingRunner 를 거쳐 기록한다.
    collectSpy.mockRejectedValueOnce(new Error(EFFORT_400)).mockResolvedValueOnce(ok);
    vi.mocked(runnerFor).mockReturnValue(recordingRunner({ collect: collectSpy, stream: vi.fn() } as never, 'c'));
    await withAiRunScope(scope, () => runSingleShot(input(), opts));
    scope.close({ ok: true });
    expect(records.at(-1)).toMatchObject({ status: 'SUCCEEDED', errorReason: null });
  });
  // WP-2122: 첫 시도가 거절로 끝나기 전에 같은 범위의 다른 호출이 월 한도로 실패했다면, 재시도 성공이 그 한도 실패까지 지우면 안 된다.
  it('겹친 다른 호출의 한도 실패는 재시도가 성공해도 남아 provider_limit/FAILED 로 기록한다', async () => {
    const LIMIT = new Error("API Error: You've hit your org's monthly spend limit");
    const records: AiRunRecord[] = [];
    const scope = new AiRunScope({ kind: 'K', tenantId: 1 }, { enqueue: (r) => void records.push(r) });
    // 다른 호출 — collect 가 동기로 던져 실패가 그 자리에서 기록된다.
    const other = recordingRunner({ collect: () => { throw LIMIT; }, stream: vi.fn() } as never, 'c');
    const wrapped = recordingRunner({ collect: collectSpy, stream: vi.fn() } as never, 'c');
    collectSpy.mockRejectedValueOnce(new Error(EFFORT_400)).mockResolvedValueOnce(ok);
    // 첫 시도의 실패가 기록된 뒤·용서 직전(재시도 경고 로그 시점)에 다른 호출이 한도로 실패한다 — 마지막 실패를 지우는 옛 용서는 이 한도 실패를 지운다.
    logMock.warn.mockImplementationOnce(() => void other.collect({ ...input(), userMessage: 'other' }).catch(() => undefined));
    vi.mocked(runnerFor).mockReturnValue(wrapped);
    await withAiRunScope(scope, () => runSingleShot(input(), opts));
    scope.close({ ok: true });
    expect(collectSpy).toHaveBeenCalledTimes(2);
    expect(records.at(-1)).toMatchObject({ status: 'FAILED', errorReason: 'provider_limit' });
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
