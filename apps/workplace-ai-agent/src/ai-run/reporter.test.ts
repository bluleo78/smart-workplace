// 묶음 전송기(WP-1828) — 버퍼·묶음 크기·주기·상한·실패 격리·동시 flush.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiRunReporter } from './reporter.js';
import type { AiRunRecord } from './types.js';

/** 테스트용 레코드 — runId 로 구분한다. */
function rec(id: number, tenantId: number | null = 1): AiRunRecord {
  return {
    runId: `r-${id}`, tenantId, kind: 'ISSUE_CHAT', targetType: null, targetId: null, targetLabel: null,
    actorType: null, actorId: null, sourceAt: null, startedAt: '2026-01-01T00:00:00Z', endedAt: null,
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, model: null,
    credentialLabel: null, status: 'SUCCEEDED', errorReason: null, errorDetail: null, attempt: 1,
  };
}

describe('AiRunReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('버퍼가 비어 있고 진행 중인 flush 도 없으면 flush 는 아무것도 보내지 않는다', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await new AiRunReporter({ send }).flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('tenantId 없는 레코드는 넣지 않는다', () => {
    const r = new AiRunReporter({ send: vi.fn().mockResolvedValue({}) });
    r.enqueue(rec(1, null));
    expect(r.size).toBe(0);
  });

  it('100건이 되면 바로 보낸다', async () => {
    const send = vi.fn().mockResolvedValue({});
    const r = new AiRunReporter({ send });
    for (let i = 0; i < 100; i++) r.enqueue(rec(i));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(100);
  });

  it('2초 지나면 쌓인 것을 보낸다', async () => {
    const send = vi.fn().mockResolvedValue({});
    const r = new AiRunReporter({ send });
    r.start();
    r.enqueue(rec(1));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(send).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('flush 는 500건씩 나눠 보낸다', async () => {
    const send = vi.fn().mockResolvedValue({});
    const r = new AiRunReporter({ send, batchSize: 100_000 });
    for (let i = 0; i < 1_200; i++) r.enqueue(rec(i));
    await r.flush();
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
    expect(r.size).toBe(0);
  });

  it('상한 2000 을 넘으면 가장 오래된 것을 버리고 경고한다', async () => {
    const log = vi.fn();
    const send = vi.fn().mockReturnValue(new Promise(() => {}));
    const r = new AiRunReporter({ send, log, batchSize: 100_000 });
    for (let i = 0; i < 2_001; i++) r.enqueue(rec(i));
    expect(r.size).toBe(2_000);
    r.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('1건');
    expect(send.mock.calls[0][0][0].runId).toBe('r-1');
    r.stop();
  });

  it('send 가 reject 해도 throw 하지 않고 그 묶음은 버린다', async () => {
    const log = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const r = new AiRunReporter({ send, log });
    r.enqueue(rec(1));
    await expect(r.flush()).resolves.toBeUndefined();
    expect(r.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('send 가 동기 throw 해도 flush 는 throw 하지 않는다', async () => {
    const log = vi.fn();
    const r = new AiRunReporter({
      send: () => {
        throw new Error('sync');
      },
      log,
    });
    r.enqueue(rec(1));
    await expect(r.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('flush 동시 호출에도 같은 레코드를 두 번 보내지 않는다', async () => {
    const sent: string[] = [];
    const send = vi.fn(async (runs: AiRunRecord[]) => {
      await Promise.resolve();
      sent.push(...runs.map((x) => x.runId));
    });
    const r = new AiRunReporter({ send, batchSize: 100_000 });
    for (let i = 0; i < 700; i++) r.enqueue(rec(i));
    await Promise.all([r.flush(), r.flush()]);
    expect(sent).toHaveLength(700);
    expect(new Set(sent).size).toBe(700);
  });

  it('진행 중 flush 동안 쌓인 레코드도 flush 한 번으로 모두 한 번씩 보낸다', async () => {
    const sent: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const send = vi.fn(async (runs: AiRunRecord[]) => {
      if (first) {
        first = false;
        await gate;
      }
      sent.push(...runs.map((x) => x.runId));
    });
    const r = new AiRunReporter({ send, batchSize: 100_000 });
    r.enqueue(rec(1));
    const inflight = r.flush();
    await Promise.resolve();
    r.enqueue(rec(2));
    r.enqueue(rec(3));
    const second = r.flush();
    release();
    await Promise.all([inflight, second]);
    await r.flush();
    expect(sent.sort()).toEqual(['r-1', 'r-2', 'r-3']);
    expect(r.size).toBe(0);
  });

  it('log 가 throw 해도 flush 는 reject 하지 않는다', async () => {
    const r = new AiRunReporter({
      send: vi.fn().mockRejectedValue(new Error('x')),
      log: () => {
        throw new Error('log');
      },
    });
    r.enqueue(rec(1));
    await expect(r.flush()).resolves.toBeUndefined();
  });

  it('진행 중 flush 가 있으면 batchSize 에 닿아도 새 flush 를 또 걸지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(async () => {
      await gate;
    });
    const r = new AiRunReporter({ send, batchSize: 2 });
    r.enqueue(rec(1));
    r.enqueue(rec(2));
    await Promise.resolve();
    r.enqueue(rec(3));
    r.enqueue(rec(4));
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await r.flush();
    expect(r.size).toBe(0);
  });
});
