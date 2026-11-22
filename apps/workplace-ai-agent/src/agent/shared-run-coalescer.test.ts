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

  it('fallback 실행 중인 같은 키의 새 이벤트는 acquire 없이 fallback 으로 보낸다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let finish!: () => void;
    const pending = new Promise<void>((r) => (finish = r));
    const store = fakeStore(async () => {
      throw new Error('timeout');
    });
    // e1(키 a)만 acquire 가 실패한다 — 이후 호출은 성공해도 되도록 바꿔 둔다
    const fb = fakeFallback();
    fb.submit.mockImplementation((e: number) => (e === 1 ? pending : Promise.resolve()));
    const c = createSharedRunCoalescer<number>({
      store: () => store,
      fallback: fb,
      run: vi.fn(async () => {}),
      onError: vi.fn(),
      key: (e) => (e >= 100 ? 'b' : 'a'),
    });
    const p1 = c.submit(1);
    await new Promise((r) => setTimeout(r, 0));
    store.acquire.mockImplementation(async () => ({ status: 'ACQUIRED', token: 'x' }));
    store.acquire.mockClear();
    await c.submit(2);
    expect(fb.submit).toHaveBeenCalledWith(2);
    expect(store.acquire).not.toHaveBeenCalled();
    // 다른 키는 임대를 쓴다
    await c.submit(100);
    expect(store.acquire).toHaveBeenCalledTimes(1);
    // fallback 과 반납이 끝나면 같은 키도 다시 acquire 한다
    finish();
    await p1;
    await c.submit(3);
    expect(store.acquire).toHaveBeenCalledTimes(2);
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
