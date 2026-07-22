import { afterEach, describe, expect, it, vi } from 'vitest';

// 생존 슬롯(opencode-spawn 의 세마포어) ↔ 웜 풀(opencode-server-pool) 의 교차 상호작용을 검증한다.
// 두 모듈을 모킹 없이 실제로 함께 돌려(오직 createOpencode 만 모킹), 웜 풀 서버가 permit 을 idle
// 상태로 점유해 풀 비대상 스폰을 굶기던 기아 버그가 demand-driven eviction 으로 해소됨을 확인한다.
const { createOpencode } = vi.hoisted(() => ({ createOpencode: vi.fn() }));
vi.mock('@opencode-ai/sdk', () => ({ createOpencode }));

import { createIsolatedOpencode } from './opencode-spawn.js';
import { acquireServer, releaseServer, closeAllServers } from './opencode-server-pool.js';

afterEach(() => {
  closeAllServers(); // 남은 풀 서버 close → 생존 슬롯 반납(테스트 간 격리)
  vi.clearAllMocks();
});

describe('생존 슬롯 ↔ 웜 풀 상호작용(기아 방지)', () => {
  it('웜 풀 서버가 생존 슬롯을 전부 점유(유휴+alive)해도, 유휴 서버 축출로 비-풀 스폰이 진행된다', async () => {
    createOpencode.mockImplementation(async () => ({
      client: {},
      server: { url: 'http://127.0.0.1:0', close: vi.fn() },
    }));

    // MAX_LIVE_SERVERS(기본 3) 만큼 서로 다른 풀 키로 스폰한 뒤 release — 요청은 끝났지만(useCount 0)
    // 아직 살아있어(웜) permit 을 계속 점유하는 상태로 만든다.
    for (let i = 0; i < 3; i++) {
      await acquireServer(`key${i}`, () => createIsolatedOpencode({} as never));
      releaseServer(`key${i}`);
    }
    expect(createOpencode).toHaveBeenCalledTimes(3);

    // 이 시점에 생존 슬롯 3개를 유휴 웜 풀 서버가 전부 점유 중. 수정 전이라면 아래 비-풀 스폰은
    // permit 을 영영 못 얻어 무기한 hang 한다(테스트 타임아웃 실패). 수정 후에는 유휴 풀 서버를
    // 축출해 슬롯을 비우고 정상 resolve 한다.
    const nonPool = await createIsolatedOpencode({} as never);
    expect(nonPool).toBeDefined();
    expect(createOpencode).toHaveBeenCalledTimes(4);

    nonPool.server.close();
  });

  it('사용 중이던 풀 서버가 요청 완료(release)되면, 대기하던(park) 스폰이 5분 TTL 없이 즉시 진행한다', async () => {
    createOpencode.mockImplementation(async () => ({
      client: {},
      server: { url: 'http://127.0.0.1:0', close: vi.fn() },
    }));
    const flush = () => new Promise((r) => setTimeout(r, 0));

    // 3 슬롯 전부 mid-request(useCount>0) 로 점유 — release 하지 않는다. 이 상태에선 축출 대상 유휴
    // 서버가 없어 새 스폰이 slot 을 못 만든다.
    for (let i = 0; i < 3; i++) {
      await acquireServer(`key${i}`, () => createIsolatedOpencode({} as never));
    }
    expect(createOpencode).toHaveBeenCalledTimes(3);

    // 4번째(비-풀) 스폰 — 유휴 서버가 없어 slot 대기(park)에 걸린다. 아직 부팅 진입 못 함.
    let resolved = false;
    const p4 = createIsolatedOpencode({} as never).then((h) => {
      resolved = true;
      return h;
    });
    await flush();
    expect(resolved).toBe(false);
    expect(createOpencode).toHaveBeenCalledTimes(3);

    // 사용 중이던 풀 서버 하나가 요청 완료 → 대기자가 있으므로 즉시 축출해 slot 을 넘긴다.
    // (수정 전이라면 여기서 idle 타이머만 걸려 p4 는 IDLE_TTL_MS 동안 hang → 이 테스트가 타임아웃 실패)
    releaseServer('key0');
    await flush();
    expect(createOpencode).toHaveBeenCalledTimes(4);
    const h4 = await p4;
    expect(resolved).toBe(true);

    h4.server.close();
    releaseServer('key1');
    releaseServer('key2');
  });
});
