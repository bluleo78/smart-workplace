import { describe, expect, it, vi } from 'vitest';

import { createStarterStore, seoulDate, STARTER_STORAGE_PREFIX } from './starterStorage';

/** 메모리 Storage — 실패 주입 가능(chatStreams.test 와 같은 방식). */
function memStorage(opts: { failGet?: boolean; failSet?: Error } = {}) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => { if (opts.failGet) throw new Error('blocked'); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.failSet) throw opts.failSet; m.set(k, v); },
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    raw: m,
  };
}

const OWNER = '1:1';
function setup(storage = memStorage(), at = '2026-10-13T00:30:00Z') {
  let now = new Date(at);
  const store = createStarterStore({ storage: () => storage, now: () => now });
  return { store, storage, setNow: (iso: string) => void (now = new Date(iso)) };
}

describe('seoulDate', () => {
  it('UTC 15:30 은 서울 다음 날', () => {
    expect(seoulDate(new Date('2026-10-13T15:30:00Z'))).toBe('2026-10-14');
    expect(seoulDate(new Date('2026-10-13T14:59:00Z'))).toBe('2026-10-13');
  });
});

describe('저장·만료', () => {
  it('저장한 결과는 오늘이면 fresh, 서울 날짜가 지나면 stale 이지만 보인다', () => {
    const { store, setNow } = setup();
    expect(store.peek(OWNER, 'general')).toBeNull();
    store.save(OWNER, 'general', ['a', 'b']);
    expect(store.peek(OWNER, 'general')).toEqual({ items: ['a', 'b'], fresh: true });
    setNow('2026-10-13T15:01:00Z'); // 서울 10-14 00:01
    expect(store.peek(OWNER, 'general')).toEqual({ items: ['a', 'b'], fresh: false });
  });
  it('새 탭(새 저장소 인스턴스)도 localStorage 에서 읽는다', () => {
    const storage = memStorage();
    setup(storage).store.save(OWNER, 'k', ['x']);
    expect(setup(storage).store.peek(OWNER, 'k')).toEqual({ items: ['x'], fresh: true });
  });
  it('사용자·워크스페이스별로 나뉜다', () => {
    const { store } = setup();
    store.save('1:1', 'general', ['a']);
    expect(store.peek('2:1', 'general')).toBeNull();
    expect(store.peek('1:2', 'general')).toBeNull();
  });
  it('최근 저장 50개까지만 남기고 오래된 것부터 지운다', () => {
    const { store, storage, setNow } = setup();
    for (let i = 0; i < 51; i++) {
      setNow(new Date(Date.parse('2026-10-13T00:00:00Z') + i * 1000).toISOString());
      store.save(OWNER, `k${i}`, ['q']);
    }
    const saved = JSON.parse(storage.raw.get(`${STARTER_STORAGE_PREFIX}${OWNER}`)!);
    expect(Object.keys(saved)).toHaveLength(50);
    expect(saved).not.toHaveProperty('k0');
    expect(saved).toHaveProperty('k50');
  });
});

describe('저장소를 못 쓸 때 (Review Focus 3)', () => {
  it('저장소가 예외를 던지면 메모리만으로 동작한다', () => {
    const { store } = setup(memStorage({ failGet: true, failSet: new Error('blocked') }));
    expect(() => store.save(OWNER, 'k', ['a'])).not.toThrow();
    expect(store.peek(OWNER, 'k')).toEqual({ items: ['a'], fresh: true });
  });
  it('용량 초과(QuotaExceededError)도 메모리에는 남는다', () => {
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const { store } = setup(memStorage({ failSet: quota }));
    store.save(OWNER, 'k', ['a']);
    expect(store.peek(OWNER, 'k')?.items).toEqual(['a']);
  });
  it('깨진 JSON 은 빈 저장소로 본다', () => {
    const storage = memStorage();
    storage.raw.set(`${STARTER_STORAGE_PREFIX}${OWNER}`, '{깨짐');
    const { store } = setup(storage);
    expect(store.peek(OWNER, 'k')).toBeNull();
    store.save(OWNER, 'k', ['a']);
    expect(store.peek(OWNER, 'k')?.items).toEqual(['a']);
  });
  it('저장소 자체가 없으면(null) 메모리만', () => {
    const store = createStarterStore({ storage: () => null });
    store.save(OWNER, 'k', ['a']);
    expect(store.peek(OWNER, 'k')?.items).toEqual(['a']);
  });
});

describe('run — 진행 중 공유·실패 기록', () => {
  it('같은 키의 동시 호출은 한 번만 부르고 결과를 저장한다', async () => {
    const { store } = setup();
    let resolve!: (v: string[]) => void;
    const fetcher = vi.fn(() => new Promise<string[]>((r) => (resolve = r)));
    const p1 = store.run(OWNER, 'k', fetcher);
    const p2 = store.run(OWNER, 'k', fetcher);
    resolve(['AI']);
    expect(await p1).toEqual(['AI']);
    expect(await p2).toEqual(['AI']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.peek(OWNER, 'k')).toEqual({ items: ['AI'], fresh: true });
  });
  it('빈 결과·실패는 그날만 기억하고 localStorage 에 쓰지 않는다', async () => {
    const { store, storage, setNow } = setup();
    expect(await store.run(OWNER, 'a', async () => [])).toEqual([]);
    expect(await store.run(OWNER, 'b', async () => { throw new Error('500'); })).toEqual([]);
    expect(store.failedToday(OWNER, 'a')).toBe(true);
    expect(store.failedToday(OWNER, 'b')).toBe(true);
    expect(storage.raw.size).toBe(0);
    setNow('2026-10-14T00:30:00Z');
    expect(store.failedToday(OWNER, 'a')).toBe(false);
  });
  it('로그아웃(clearAll) 전에 시작한 요청이 뒤늦게 끝나도 저장소를 다시 채우지 않는다', async () => {
    const { store, storage } = setup();
    let resolve!: (v: string[]) => void;
    const p = store.run(OWNER, 'k', () => new Promise<string[]>((r) => (resolve = r)));
    store.clearAll();
    resolve(['AI']);
    expect(await p).toEqual(['AI']); // 호출자에게는 결과를 돌려준다
    expect(store.peek(OWNER, 'k')).toBeNull();
    expect(storage.raw.size).toBe(0);
  });
  it('로그아웃 전 요청이 실패해도 실패 기록을 남기지 않는다', async () => {
    const { store } = setup();
    let reject!: (e: Error) => void;
    const p = store.run(OWNER, 'k', () => new Promise<string[]>((_, r) => (reject = r)));
    store.clearAll();
    reject(new Error('500'));
    expect(await p).toEqual([]);
    expect(store.failedToday(OWNER, 'k')).toBe(false);
  });
  it('clearAll 뒤 새로 시작한 요청은 옛 요청이 끝나도 계속 공유된다', async () => {
    const { store } = setup();
    let resolveOld!: (v: string[]) => void;
    let resolveNew!: (v: string[]) => void;
    const oldP = store.run(OWNER, 'k', () => new Promise<string[]>((r) => (resolveOld = r)));
    store.clearAll();
    const newFetcher = vi.fn(() => new Promise<string[]>((r) => (resolveNew = r)));
    const newP = store.run(OWNER, 'k', newFetcher);
    resolveOld(['old']);
    await oldP;
    const sharedFetcher = vi.fn(async () => ['third']);
    const sharedP = store.run(OWNER, 'k', sharedFetcher); // 옛 요청의 finally 가 새 진행 중 표시를 지웠다면 여기서 새로 부른다
    expect(sharedFetcher).not.toHaveBeenCalled();
    resolveNew(['new']);
    expect(await sharedP).toEqual(['new']);
    expect(await newP).toEqual(['new']);
    expect(newFetcher).toHaveBeenCalledTimes(1);
    expect(store.peek(OWNER, 'k')?.items).toEqual(['new']);
  });
  it('resetFailures 는 실패 기록만 지운다(설정을 다시 켰을 때)', async () => {
    const { store } = setup();
    await store.run(OWNER, 'a', async () => []);
    store.resetFailures();
    expect(store.failedToday(OWNER, 'a')).toBe(false);
  });
});

describe('clearAll — 로그아웃', () => {
  it('추천 저장 키만 지우고 메모리도 비운다', () => {
    const storage = memStorage();
    storage.raw.set('other', 'keep');
    const { store } = setup(storage);
    store.save('1:1', 'k', ['a']);
    store.save('2:1', 'k', ['b']);
    store.clearAll();
    expect([...storage.raw.keys()]).toEqual(['other']);
    expect(store.peek('1:1', 'k')).toBeNull();
  });
  it('removeItem 이 던져도 예외 없이 메모리는 비운다', () => {
    const storage = memStorage();
    const { store } = setup(storage);
    store.save(OWNER, 'k', ['a']);
    storage.removeItem = () => { throw new Error('blocked'); };
    expect(() => store.clearAll()).not.toThrow();
    expect(store.peek(OWNER, 'k')?.items).toEqual(['a']); // 메모리는 비었지만 localStorage 에서 다시 읽힌다(지우지 못한 경우)
  });
  it('key 가 던져도 예외 없이 메모리는 비운다', () => {
    const storage = memStorage();
    const { store } = setup(storage);
    store.save(OWNER, 'k', ['a']);
    storage.key = () => { throw new Error('blocked'); };
    expect(() => store.clearAll()).not.toThrow();
  });
});
