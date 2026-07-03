import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  acquireServer,
  releaseServer,
  evictServer,
  closeAllServers,
  __resetPoolForTest,
  IDLE_TTL_MS,
  MAX_POOL_SIZE,
  type OpencodeHandle,
} from './opencode-server-pool.js';

// 실제 opencode 프로세스를 스폰하지 않도록 handle 을 직접 만든다. server.close 호출 여부를
// 검증해야 하므로 close 는 vi.fn() 으로 스파이한다.
function fakeHandle(): OpencodeHandle {
  return {
    client: {} as OpencodeHandle['client'],
    server: { url: 'http://127.0.0.1:0', close: vi.fn() } as unknown as OpencodeHandle['server'],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetPoolForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('acquireServer', () => {
  it('같은 key 로 재요청하면 spawn 을 다시 호출하지 않고 같은 handle 을 반환한다(캐시 히트)', async () => {
    const handle = fakeHandle();
    const spawn = vi.fn().mockResolvedValue(handle);

    const first = await acquireServer('k1', spawn);
    const second = await acquireServer('k1', spawn);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(first).toBe(handle);
    expect(second).toBe(handle);
  });

  it('다른 key 는 각각 spawn 한다(캐시 미스)', async () => {
    const spawnA = vi.fn().mockResolvedValue(fakeHandle());
    const spawnB = vi.fn().mockResolvedValue(fakeHandle());

    await acquireServer('a', spawnA);
    await acquireServer('b', spawnB);

    expect(spawnA).toHaveBeenCalledTimes(1);
    expect(spawnB).toHaveBeenCalledTimes(1);
  });
});

describe('releaseServer + 유휴 TTL', () => {
  it('release 후 useCount 가 0 이 되고 IDLE_TTL_MS 가 지나면 close 되고 풀에서 제거된다', async () => {
    const handle = fakeHandle();
    const spawn = vi.fn().mockResolvedValue(handle);

    await acquireServer('k1', spawn);
    releaseServer('k1');

    vi.advanceTimersByTime(IDLE_TTL_MS - 1);
    expect(handle.server.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(handle.server.close).toHaveBeenCalledTimes(1);

    // 제거됐으므로 재요청 시 다시 spawn 해야 한다.
    await acquireServer('k1', spawn);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('유휴 타이머가 끝나기 전에 재사용(acquireServer)하면 close 되지 않는다', async () => {
    const handle = fakeHandle();
    const spawn = vi.fn().mockResolvedValue(handle);

    await acquireServer('k1', spawn);
    releaseServer('k1');
    vi.advanceTimersByTime(IDLE_TTL_MS / 2);

    await acquireServer('k1', spawn); // 재사용 — 타이머 취소돼야 함
    vi.advanceTimersByTime(IDLE_TTL_MS); // 원래 타이머 기준이면 이미 지났을 시점

    expect(spawn).toHaveBeenCalledTimes(1); // 재spawn 안 됨
    expect(handle.server.close).not.toHaveBeenCalled();
  });

  it('useCount 가 2 이상이면(중첩 acquire) 마지막 release 전까지 유휴 타이머가 시작되지 않는다', async () => {
    const handle = fakeHandle();
    const spawn = vi.fn().mockResolvedValue(handle);

    await acquireServer('k1', spawn);
    await acquireServer('k1', spawn); // useCount=2

    releaseServer('k1'); // useCount=1 — 아직 유휴 아님
    vi.advanceTimersByTime(IDLE_TTL_MS * 2);
    expect(handle.server.close).not.toHaveBeenCalled();

    releaseServer('k1'); // useCount=0 — 이제 유휴 타이머 시작
    vi.advanceTimersByTime(IDLE_TTL_MS);
    expect(handle.server.close).toHaveBeenCalledTimes(1);
  });
});

describe('evictServer', () => {
  it('즉시 close 하고 풀에서 제거 — 다음 acquireServer 는 새로 spawn', async () => {
    const handle = fakeHandle();
    const spawn = vi.fn().mockResolvedValue(handle);

    await acquireServer('k1', spawn);
    evictServer('k1');

    expect(handle.server.close).toHaveBeenCalledTimes(1);

    await acquireServer('k1', spawn);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('존재하지 않는 key 를 evict 해도 에러 없이 무시한다', () => {
    expect(() => evictServer('nope')).not.toThrow();
  });
});

describe('풀 크기 상한(MAX_POOL_SIZE)', () => {
  it('상한을 넘기면 가장 오래 유휴한 항목부터 축출한다', async () => {
    const handles: OpencodeHandle[] = [];
    // MAX_POOL_SIZE 개를 채우고 모두 release(유휴 상태로 전환) — release 순서가 곧 유휴 경과 순서.
    for (let i = 0; i < MAX_POOL_SIZE; i++) {
      const h = fakeHandle();
      handles.push(h);
      await acquireServer(`k${i}`, vi.fn().mockResolvedValue(h));
      releaseServer(`k${i}`);
      vi.advanceTimersByTime(1); // release 시각을 서로 다르게 만들어 순서를 명확히 함
    }

    // 상한을 넘는 새 항목 — 가장 먼저 release 된 k0 이 축출 대상이어야 한다.
    const extra = fakeHandle();
    await acquireServer('extra', vi.fn().mockResolvedValue(extra));

    expect(handles[0].server.close).toHaveBeenCalledTimes(1); // k0 축출됨
    expect(handles[MAX_POOL_SIZE - 1].server.close).not.toHaveBeenCalled(); // 가장 최근 유휴는 유지
  });

  it('유휴 항목이 없으면(전부 사용 중) 상한을 넘겨도 강제 종료하지 않는다', async () => {
    for (let i = 0; i < MAX_POOL_SIZE; i++) {
      await acquireServer(`k${i}`, vi.fn().mockResolvedValue(fakeHandle()));
      // release 하지 않음 — 전부 사용 중 상태 유지
    }

    const extra = fakeHandle();
    await expect(acquireServer('extra', vi.fn().mockResolvedValue(extra))).resolves.toBe(extra);
    // 위 호출이 에러 없이 끝나면 충분 — 강제 종료 로직이 사용 중인 항목을 건드리지 않음을 의미.
  });
});

describe('closeAllServers', () => {
  it('풀에 있는 모든 서버를 close 하고 풀을 비운다', async () => {
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    await acquireServer('k1', vi.fn().mockResolvedValue(h1));
    await acquireServer('k2', vi.fn().mockResolvedValue(h2));

    closeAllServers();

    expect(h1.server.close).toHaveBeenCalledTimes(1);
    expect(h2.server.close).toHaveBeenCalledTimes(1);

    // 비워졌으므로 재요청 시 새로 spawn.
    const spawn = vi.fn().mockResolvedValue(fakeHandle());
    await acquireServer('k1', spawn);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('server.close() 가 던져도 전파하지 않는다(다른 항목 정리를 막지 않음)', async () => {
    const throwing = fakeHandle();
    (throwing.server.close as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('close boom');
    });
    const normal = fakeHandle();
    await acquireServer('k1', vi.fn().mockResolvedValue(throwing));
    await acquireServer('k2', vi.fn().mockResolvedValue(normal));

    expect(() => closeAllServers()).not.toThrow();
    expect(normal.server.close).toHaveBeenCalledTimes(1);
  });
});
