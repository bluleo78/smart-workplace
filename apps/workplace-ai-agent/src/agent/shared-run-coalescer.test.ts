// WP-1979: 파드 사이 공유 임대로 대화별 실행을 하나만 돌리는 합치기 — 가짜 store·가짜 run 으로 흐름을 검증한다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSharedRunCoalescer, type RunLeaseStore } from './shared-run-coalescer.js';
import type { RunCoalescer } from './run-coalescer.js';
import { inflightCount } from '../graceful-shutdown.js';

type Acq = Awaited<ReturnType<RunLeaseStore<number>['acquire']>>;

/** 가짜 저장소 — acquire 결과와 release 가 줄 밀린 이벤트를 차례로 정한다. */
function fakeStore(acquire: () => Promise<Acq>, releases: Array<number | null | Error> = [null]) {
  const rel = [...releases];
  return {
    acquire: vi.fn(acquire),
    release: vi.fn(async () => {
      const r = rel.shift() ?? null;
      if (r instanceof Error) throw r;
      return r;
    }),
  } satisfies RunLeaseStore<number>;
}

function fakeFallback() {
  return { submit: vi.fn((_e: number) => undefined as Promise<void> | undefined), activeKeys: () => 0 } satisfies RunCoalescer<number>;
}

/** 서버 임대 행 하나를 흉내 내는 저장소 — MessagingAgentRunService 의 acquire·release 판정을 그대로 옮겼다(이벤트 값 = messageId). */
function fakeServer() {
  const row = { owner: null as string | null, lastStarted: 0, pending: null as number | null };
  const store = {
    acquire: vi.fn(async (id: number, _lease: number, token: string): Promise<Acq> => {
      if (id <= row.lastStarted || (row.pending !== null && id <= row.pending)) return { status: 'DUPLICATE' };
      if (row.owner === null) {
        row.owner = token;
        row.lastStarted = id;
        row.pending = null;
        return { status: 'ACQUIRED', token };
      }
      row.pending = id;
      return { status: 'QUEUED' };
    }),
    release: vi.fn(async (_id: number, token: string) => {
      if (row.owner !== token) return null;
      if (row.pending !== null) {
        const next = row.pending;
        row.lastStarted = next;
        row.pending = null;
        return next;
      }
      row.owner = null;
      return null;
    }),
  } satisfies RunLeaseStore<number>;
  return { row, store };
}

const acquired = async (): Promise<Acq> => ({ status: 'ACQUIRED', token: 't1' });

describe('createSharedRunCoalescer (WP-1979)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acquired 면 실행하고 release 한다', async () => {
    const store = fakeStore(acquired);
    const run = vi.fn(async () => {});
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn() });
    await c.submit(10);
    expect(run).toHaveBeenCalledWith(10);
    expect(store.release).toHaveBeenCalledWith(10, 't1', 15 * 60 * 1000 + 60000);
  });

  it('release 가 밀린 이벤트를 주면 그것으로 한 번 더 실행한다', async () => {
    const store = fakeStore(acquired, [12, null]);
    const run = vi.fn(async (_e: number) => {});
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn() });
    await c.submit(10);
    expect(run.mock.calls.map((x) => x[0])).toEqual([10, 12]);
    expect(store.release).toHaveBeenCalledTimes(2);
  });

  it('queued·duplicate 는 실행하지 않는다', async () => {
    for (const status of ['QUEUED', 'DUPLICATE'] as const) {
      const store = fakeStore(async () => ({ status }));
      const run = vi.fn(async () => {});
      const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn() });
      await expect(c.submit(10)).resolves.toBeUndefined();
      expect(run).not.toHaveBeenCalled();
      expect(store.release).not.toHaveBeenCalled();
    }
  });

  it('acquire 에 coalescer 가 만든 UUID 토큰을 넘기고 같은 토큰으로 release 한다', async () => {
    const store = fakeStore(async () => ({ status: 'ACQUIRED', token: 'srv' }));
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run: async () => {}, onError: vi.fn() });
    await c.submit(10);
    const token = (store.acquire.mock.calls[0] as unknown[])[2] as string;
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    // 서버가 돌려준 토큰(구버전 api 는 자기 토큰)을 쓴다
    expect(store.release).toHaveBeenCalledWith(10, 'srv', expect.any(Number));
  });

  it('acquire 실패 → fallback 이 끝난 뒤 acquire 때 만든 토큰으로 release 한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    const store = fakeStore(async () => {
      throw new Error('timeout');
    });
    store.release.mockImplementation(async () => {
      order.push('release');
      return null;
    });
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => {
      order.push('fallback');
      return Promise.resolve();
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run: vi.fn(async () => {}), onError: vi.fn() });
    await c.submit(10);
    const token = (store.acquire.mock.calls[0] as unknown[])[2];
    expect(store.release).toHaveBeenCalledWith(10, token, 15 * 60 * 1000 + 60000);
    expect(order).toEqual(['fallback', 'release']);
  });

  it('acquire 실패 뒤 release 가 밀린 이벤트를 주면 소유 루프로 실행하고 다시 release 한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(async () => {
      throw new Error('502');
    }, [12, null]);
    const run = vi.fn(async (_e: number) => {});
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn() });
    await c.submit(10);
    const token = (store.acquire.mock.calls[0] as unknown[])[2];
    expect(run.mock.calls.map((x) => x[0])).toEqual([12]);
    expect(store.release).toHaveBeenCalledTimes(2);
    expect(store.release).toHaveBeenLastCalledWith(12, token, expect.any(Number));
  });

  it('acquire 실패 뒤 release 도 실패하면 경고 한 줄만 하고 이행한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(async () => {
      throw new Error('404');
    }, [new Error('404')]);
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run: vi.fn(async () => {}), onError: vi.fn() });
    await expect(c.submit(10)).resolves.toBeUndefined();
    expect(store.release).toHaveBeenCalledTimes(1);
    // acquire 실패 경고 1 + release 실패 경고 1
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('fallback 실행이 실패해도 release 는 하고 그 오류로 reject 한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(async () => {
      throw new Error('404');
    });
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => Promise.reject(new Error('fb 오류')));
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run: vi.fn(async () => {}), onError: vi.fn() });
    await expect(c.submit(10)).rejects.toThrow('fb 오류');
    expect(store.release).toHaveBeenCalledTimes(1);
  });

  // WP-1979 반려 1(가): 폴백 뒤 release 가 넘긴 밀린 이벤트를 도는 동안 온 같은 키 메시지가 따로 돌면 한 파드 안에서 겹친다.
  it('폴백 뒤 release 가 넘긴 이벤트를 도는 동안 온 같은 키 이벤트는 기다렸다가 끝난 뒤 최신 것만 처리한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let finishOwned!: () => void;
    const owned = new Promise<void>((r) => (finishOwned = r));
    // 첫 acquire 는 실패(폴백) → release 가 밀린 5 를 넘긴다 → 5 를 소유 루프로 돈다
    const store = fakeStore(async () => {
      throw new Error('timeout');
    }, [5, null]);
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => Promise.resolve());
    let running = 0;
    let maxRunning = 0;
    const run = vi.fn(async (e: number) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      if (e === 5) await owned;
      running--;
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run, onError: vi.fn(), key: () => 'a' });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(run.mock.calls.map((x) => x[0])).toEqual([5]);
    // 5 를 임대로 도는 동안 같은 키 새 이벤트 둘 — 폴백으로도 바로 돌지 않고 서버 대기로 간다(QUEUED, 리뷰 후속)
    store.acquire.mockImplementation(async () => ({ status: 'QUEUED' }));
    store.acquire.mockClear();
    await c.submit(2);
    await c.submit(3);
    expect(store.acquire.mock.calls.map((x) => (x as unknown[])[0])).toEqual([2, 3]);
    expect(fb.submit).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    // 서버 대기는 최신 하나(3)만 남아 5 의 release 가 넘겨준다
    store.release.mockReset();
    store.release.mockResolvedValueOnce(3).mockResolvedValue(null);
    finishOwned();
    await p1;
    expect(run.mock.calls.map((x) => x[0])).toEqual([5, 3]);
    expect(maxRunning).toBe(1);
  });

  it('폴백 뒤 release 응답을 기다리는 동안 온 같은 키 이벤트도 기다린다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let finishRelease!: (v: number | null) => void;
    const store = fakeStore(async () => {
      throw new Error('timeout');
    });
    store.release.mockImplementationOnce(() => new Promise<number | null>((r) => (finishRelease = r)));
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => Promise.resolve());
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run: vi.fn(async () => {}), onError: vi.fn(), key: () => 'a' });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.release).toHaveBeenCalledTimes(1);
    await c.submit(2);
    // release 를 기다리는 동안엔 폴백으로도 acquire 로도 가지 않는다
    expect(fb.submit).toHaveBeenCalledTimes(1);
    expect(store.acquire).toHaveBeenCalledTimes(1);
    finishRelease(null);
    await p1;
    expect(store.acquire).toHaveBeenCalledTimes(2);
    expect((store.acquire.mock.calls[1] as unknown[])[0]).toBe(2);
  });

  // WP-1979 반려 1(나): acquire 두 개가 동시에 떠 하나는 폴백, 하나는 ACQUIRED 로 끝나면 둘 다 돈다.
  it('acquire 응답을 기다리는 동안 온 같은 키 이벤트는 두 번째 acquire 를 띄우지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let failFirst!: (e: Error) => void;
    const store = fakeStore(acquired);
    store.acquire.mockImplementationOnce(() => new Promise<Acq>((_r, rej) => (failFirst = rej)));
    const fb = fakeFallback();
    let running = 0;
    let maxRunning = 0;
    const track = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 0));
      running--;
    };
    fb.submit.mockImplementation(() => track());
    const run = vi.fn(async (_e: number) => track());
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run, onError: vi.fn(), key: () => 'a' });
    const p1 = c.submit(1);
    await c.submit(2);
    expect(store.acquire).toHaveBeenCalledTimes(1);
    failFirst(new Error('timeout'));
    await p1;
    // 1 은 폴백으로, 2 는 1 이 끝난 뒤 임대로 — 둘이 겹치지 않는다
    expect(fb.submit).toHaveBeenCalledWith(1);
    expect(run.mock.calls.map((x) => x[0])).toEqual([2]);
    expect(store.acquire).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
  });

  // WP-1979 2차 반려: 대기 칸의 옛 이벤트(e3)가 다른 파드로 간 더 새 이벤트(e4)의 답 뒤에 두 번째 답을 내지 않는다 —
  // 서버 acquire 가 last_started 이하 메시지를 DUPLICATE 로 거르는 판정(MessagingAgentRunService.acquire)을 가짜 저장소로 옮겨 확인한다.
  it('대기 칸의 옛 이벤트는 다른 파드의 더 새 이벤트가 먼저 돌았으면 서버 DUPLICATE 로 다시 돌지 않는다', async () => {
    // 서버 행 하나를 흉내 낸다 — 이벤트 값이 곧 messageId
    const row = { owner: null as string | null, lastStarted: 0, pending: null as number | null };
    const server: RunLeaseStore<number> = {
      acquire: vi.fn(async (id: number, _lease: number, token: string): Promise<Acq> => {
        if (id <= row.lastStarted || (row.pending !== null && id <= row.pending)) return { status: 'DUPLICATE' };
        if (row.owner === null) {
          row.owner = token;
          row.lastStarted = id;
          row.pending = null;
          return { status: 'ACQUIRED', token };
        }
        row.pending = id;
        return { status: 'QUEUED' };
      }),
      release: vi.fn(async (_id: number, token: string) => {
        if (row.owner !== token) return null;
        if (row.pending !== null) {
          const next = row.pending;
          row.lastStarted = next;
          row.pending = null;
          return next;
        }
        row.owner = null;
        return null;
      }),
    };
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const podA = createSharedRunCoalescer<number>({ store: () => server, fallback: fakeFallback(), run, onError: vi.fn(), key: () => 'a' });
    const p1 = podA.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    // e1 이 도는 동안 e3 는 파드 A 의 대기 칸에, 더 새 e4 는 파드 B 가 보내 서버 대기(QUEUED)로
    await podA.submit(3);
    await expect(server.acquire(4, 1000, 'pod-b')).resolves.toEqual({ status: 'QUEUED' });
    finish();
    await p1;
    // e1 → (release 가 넘긴) e4 로 끝나고, 대기 칸의 e3 는 acquire 에서 DUPLICATE 라 돌지 않는다
    expect(run.mock.calls.map((x) => x[0])).toEqual([1, 4]);
    // e3 는 e1 을 쥔 동안 와서 서버 대기로 갔고(QUEUED) 더 새 e4 가 그 대기를 덮었다
    expect(server.acquire).toHaveBeenNthCalledWith(2, 3, expect.any(Number), expect.any(String));
    await expect((server.acquire as ReturnType<typeof vi.fn>).mock.results[1]!.value).resolves.toEqual({ status: 'QUEUED' });
    expect(row).toEqual({ owner: null, lastStarted: 4, pending: null });
  });

  // WP-1979 리뷰 후속: 반대 순서 — 다른 파드의 더 옛 e2 가 서버 대기이고, 이 파드가 e1 을 쥔 동안 더 새 e3 가 오면 e3 만 돈다.
  it('소유 중 온 같은 키 이벤트는 서버 대기로 보내 다른 파드의 더 옛 대기를 덮는다 — 옛 e2 와 새 e3 에 두 번 답하지 않는다', async () => {
    const { row, store } = fakeServer();
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const podA = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn(), key: () => 'a' });
    const p1 = podA.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    // 파드 B 의 더 옛 e2 가 먼저 서버 대기에 오르고, 그 뒤 파드 A 에 더 새 e3 가 온다
    await expect(store.acquire(2, 1000, 'pod-b')).resolves.toEqual({ status: 'QUEUED' });
    await podA.submit(3);
    expect(row.pending).toBe(3);
    finish();
    await p1;
    // e1 → (release 가 넘긴) e3 로 끝난다 — e2 는 돌지 않는다
    expect(run.mock.calls.map((x) => x[0])).toEqual([1, 3]);
    expect(row).toEqual({ owner: null, lastStarted: 3, pending: null });
  });

  it('소유 루프의 마지막 release 뒤에 닿은 acquire 가 ACQUIRED 면 그 토큰으로 겹치지 않게 돈다', async () => {
    const { row, store } = fakeServer();
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));
    const realRelease = store.release.getMockImplementation()!;
    // e1 의 release 가 끝난 뒤에야 e2 의 acquire 가 서버에 닿게 한다
    let acquireGate!: () => void;
    const acquireWait = new Promise<void>((r) => (acquireGate = r));
    const realAcquire = store.acquire.getMockImplementation()!;
    store.acquire.mockImplementation(async (id, lease, token) => {
      if (id === 2) await acquireWait;
      return realAcquire(id, lease, token);
    });
    store.release.mockImplementation(async (id, token) => {
      const r = await realRelease(id, token);
      if (id === 1) releaseGate();
      return r;
    });
    let running = 0;
    let maxRunning = 0;
    const run = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 0));
      running--;
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn(), key: () => 'a' });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    const p2 = c.submit(2);
    await gate;
    await p1;
    acquireGate();
    await p2;
    expect(run.mock.calls.map((x) => (x as unknown[])[0])).toEqual([1, 2]);
    expect(maxRunning).toBe(1);
    expect(row).toEqual({ owner: null, lastStarted: 2, pending: null });
  });

  it('소유 중 온 이벤트의 acquire 가 실패하면 지금 소유 루프가 끝난 뒤 fallback 으로 답하고 그 토큰으로 반납한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const store = fakeStore(acquired, [null, null]);
    store.acquire.mockImplementationOnce(acquired).mockImplementationOnce(async () => {
      throw new Error('timeout');
    });
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => Promise.resolve());
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run, onError: vi.fn(), key: () => 'a' });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    await c.submit(2);
    // 1 이 도는 동안에는 폴백으로 돌지 않는다(같은 파드 겹침 없음)
    expect(fb.submit).not.toHaveBeenCalled();
    finish();
    await p1;
    const token2 = (store.acquire.mock.calls[1] as unknown[])[2];
    expect(run.mock.calls.map((x) => x[0])).toEqual([1]);
    expect(fb.submit).toHaveBeenCalledWith(2);
    expect(store.release).toHaveBeenLastCalledWith(2, token2, expect.any(Number));
    // 다시 acquire 하지 않는다
    expect(store.acquire).toHaveBeenCalledTimes(2);
  });

  it('소유 중 온 이벤트의 acquire 가 서버에 커밋(ACQUIRED)된 뒤 응답만 잃어도 그 이벤트는 한 번 답한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { row, store } = fakeServer();
    const realAcquire = store.acquire.getMockImplementation()!;
    const realRelease = store.release.getMockImplementation()!;
    let released1!: () => void;
    const afterRelease1 = new Promise<void>((r) => (released1 = r));
    // e1 의 release 가 임대를 비운 뒤에 e3 의 acquire 가 서버에 닿아 ACQUIRED 로 커밋되지만, 응답은 잃는다
    store.release.mockImplementation(async (id, token) => {
      const r = await realRelease(id, token);
      if (id === 1) released1();
      return r;
    });
    let lost = false;
    store.acquire.mockImplementation(async (id, lease, token) => {
      if (id !== 3 || lost) return realAcquire(id, lease, token);
      lost = true;
      await afterRelease1;
      await realAcquire(id, lease, token);
      throw new Error('timeout');
    });
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => Promise.resolve());
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const podA = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run, onError: vi.fn(), key: () => 'a' });
    const p1 = podA.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    const p3 = podA.submit(3);
    finish();
    await p1;
    await p3;
    // e3 는 폴백으로 한 번 답하고, 커밋된 임대는 그 토큰으로 반납돼 비었다
    const answered3 = run.mock.calls.filter((x) => x[0] === 3).length + fb.submit.mock.calls.filter((x) => x[0] === 3).length;
    expect(answered3).toBe(1);
    expect(row).toEqual({ owner: null, lastStarted: 3, pending: null });
  });

  it('소유 중 온 이벤트의 acquire 가 서버 대기(QUEUED)로 커밋된 뒤 응답만 잃어도 release 로 넘겨받아 한 번만 답한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { row, store } = fakeServer();
    const realAcquire = store.acquire.getMockImplementation()!;
    let lost = false;
    store.acquire.mockImplementation(async (id, lease, token) => {
      if (id !== 3 || lost) return realAcquire(id, lease, token);
      lost = true;
      await realAcquire(id, lease, token);
      throw new Error('timeout');
    });
    const fb = fakeFallback();
    fb.submit.mockImplementation(() => Promise.resolve());
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const podA = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run, onError: vi.fn(), key: () => 'a', order: (e) => e });
    const p1 = podA.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    await podA.submit(3);
    expect(row.pending).toBe(3);
    finish();
    await p1;
    // e1 의 release 가 e3 를 넘겨 돌았고, 실패한 acquire 의 처리(recover)는 폴백으로 또 답하지 않는다
    expect(run.mock.calls.map((x) => x[0])).toEqual([1, 3]);
    expect(fb.submit).not.toHaveBeenCalled();
    expect(row).toEqual({ owner: null, lastStarted: 3, pending: null });
  });

  it('acquire 응답을 기다리는 동안 대기 칸에 온 새 이벤트도 반납 전에 서버 대기로 보내 다른 파드의 옛 대기와 두 번 답하지 않는다', async () => {
    const { row, store } = fakeServer();
    const realAcquire = store.acquire.getMockImplementation()!;
    let letAcquire!: () => void;
    const acquireWait = new Promise<void>((r) => (letAcquire = r));
    store.acquire.mockImplementationOnce(async (id, lease, token) => {
      await acquireWait;
      return realAcquire(id, lease, token);
    });
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const podA = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn(), key: () => 'a' });
    const p1 = podA.submit(1);
    // e1 의 acquire 가 아직 서버에 닿지 않은 동안 e3 가 온다 — 대기 칸으로
    await podA.submit(3);
    letAcquire();
    await new Promise((r) => setTimeout(r, 0));
    // 파드 A 가 e1 임대를 얻은 뒤 파드 B 의 더 옛 e2 가 서버 대기에 오른다
    await expect(store.acquire(2, 1000, 'pod-b')).resolves.toEqual({ status: 'QUEUED' });
    finish();
    await p1;
    expect(run.mock.calls.map((x) => x[0])).toEqual([1, 3]);
    expect(row).toEqual({ owner: null, lastStarted: 3, pending: null });
  });

  it('다른 키는 서로 기다리지 않는다', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const store = fakeStore(acquired, [null, null]);
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn(), key: (e) => (e >= 100 ? 'b' : 'a') });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    await c.submit(100);
    expect(run.mock.calls.map((x) => x[0])).toEqual([1, 100]);
    finish();
    await p1;
  });

  it('이어 받은 이벤트의 실행 오류도 기록하고 먼저 쥔 submit 이 첫 오류로 거부한다', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((r) => (finish = r));
    const store = fakeStore(acquired, [null, null]);
    const onError = vi.fn();
    const run = vi.fn(async (e: number) => {
      if (e === 1) await blocked;
      if (e === 2) throw new Error('이어 받은 오류');
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError, key: () => 'a' });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    await c.submit(2);
    finish();
    await expect(p1).rejects.toThrow('이어 받은 오류');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('확실한 HTTP 거절이면 fallback 뒤 release 를 건너뛴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(async () => {
      throw Object.assign(new Error('404'), { status: 404 });
    });
    const c = createSharedRunCoalescer<number>({
      store: () => store,
      fallback: fakeFallback(),
      run: vi.fn(async () => {}),
      onError: vi.fn(),
      mayHaveCommitted: (e) => (e as { status?: number }).status === undefined,
    });
    await c.submit(10);
    expect(store.release).not.toHaveBeenCalled();
  });

  it('응답을 잃었을 수 있는 실패면 release 한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(async () => {
      throw new Error('timeout');
    });
    const c = createSharedRunCoalescer<number>({
      store: () => store,
      fallback: fakeFallback(),
      run: vi.fn(async () => {}),
      onError: vi.fn(),
      mayHaveCommitted: (e) => (e as { status?: number }).status === undefined,
    });
    await c.submit(10);
    expect(store.release).toHaveBeenCalledTimes(1);
  });

  it('acquire 실패 시 메모리 합치기', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(async () => {
      throw new Error('404');
    });
    const fb = fakeFallback();
    const run = vi.fn(async () => {});
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fb, run, onError: vi.fn() });
    await c.submit(10);
    expect(fb.submit).toHaveBeenCalledWith(10);
    expect(run).not.toHaveBeenCalled();
  });

  it('실행 실패해도 release·재실행하고 첫 오류로 reject', async () => {
    const store = fakeStore(acquired, [12, null]);
    const onError = vi.fn();
    const run = vi.fn(async (e: number) => {
      if (e === 10) throw new Error('첫 오류');
    });
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError });
    await expect(c.submit(10)).rejects.toThrow('첫 오류');
    expect(run.mock.calls.map((x) => x[0])).toEqual([10, 12]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.release).toHaveBeenCalledTimes(2);
  });

  it('release 실패는 경고만 하고 끝난다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore(acquired, [new Error('끊김')]);
    const run = vi.fn(async () => {});
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run, onError: vi.fn() });
    await expect(c.submit(10)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('실행을 trackInflight 에 등록한다', async () => {
    const store = fakeStore(acquired);
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run: async () => {}, onError: vi.fn() });
    const before = inflightCount();
    const p = c.submit(10);
    expect(inflightCount()).toBe(before + 1);
    await p;
    await new Promise((r) => setTimeout(r, 0));
    expect(inflightCount()).toBe(before);
  });

  it('임대는 maxRunMs + 60000 으로 요청한다', async () => {
    const store = fakeStore(acquired);
    const c = createSharedRunCoalescer<number>({ store: () => store, fallback: fakeFallback(), run: async () => {}, onError: vi.fn(), maxRunMs: 1000 });
    await c.submit(10);
    expect(store.acquire).toHaveBeenCalledWith(10, 61000, expect.any(String));
  });
});
