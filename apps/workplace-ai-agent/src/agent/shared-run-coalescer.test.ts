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
    // 5 가 도는 동안 같은 키 새 이벤트 둘 — 폴백·acquire 어느 쪽으로도 바로 돌지 않는다
    store.acquire.mockImplementation(async () => ({ status: 'ACQUIRED', token: 't2' }));
    store.acquire.mockClear();
    await c.submit(2);
    await c.submit(3);
    expect(store.acquire).not.toHaveBeenCalled();
    expect(fb.submit).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    finishOwned();
    await p1;
    // 끝난 뒤 가장 최근 것(3)만 임대로 이어 처리한다
    expect(store.acquire).toHaveBeenCalledTimes(1);
    expect((store.acquire.mock.calls[0] as unknown[])[0]).toBe(3);
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
