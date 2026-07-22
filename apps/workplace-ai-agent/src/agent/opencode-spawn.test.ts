import { existsSync } from 'node:fs';

import { describe, expect, it, vi, beforeEach } from 'vitest';

// @opencode-ai/sdk 의 createOpencode 만 모킹한다. 데이터 디렉터리 생성/정리는 실제 fs(temp)로
// 검증한다(격리의 핵심이 실제 디렉터리 수명 관리이므로 실 파일시스템으로 확인하는 게 신뢰도가 높다).
const { createOpencode } = vi.hoisted(() => ({ createOpencode: vi.fn() }));
vi.mock('@opencode-ai/sdk', () => ({ createOpencode }));

import { createIsolatedOpencode } from './opencode-spawn.js';

// createOpencodeServer 는 launch(자식 spawn)에서 process.env.XDG_DATA_HOME 을 "동기적으로" 캡처한다.
// 모킹된 createOpencode 도 그 시점을 흉내내기 위해 본문 첫 줄에서 동기적으로 env 를 읽어 기록한다.
function mockHandle(onCapture: (dir: string | undefined) => void, close = vi.fn()) {
  createOpencode.mockImplementation(async () => {
    onCapture(process.env.XDG_DATA_HOME);
    return { client: { session: {}, event: {} }, server: { url: 'http://127.0.0.1:12345', close } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createIsolatedOpencode', () => {
  it('createOpencode 를 config + port:0 으로 호출한다', async () => {
    let dir: string | undefined;
    mockHandle((d) => (dir = d));
    const cfg = { foo: 'bar' } as never;

    const handle = await createIsolatedOpencode(cfg);

    expect(createOpencode).toHaveBeenCalledWith({ config: cfg, port: 0 });
    // 정리(누수 방지)
    handle.server.close();
    void dir;
  });

  it('스폰 중 XDG_DATA_HOME 을 고유 temp 디렉터리로 설정하고, 호출 후 원래 값으로 복원한다', async () => {
    const before = process.env.XDG_DATA_HOME;
    let captured: string | undefined;
    mockHandle((d) => (captured = d));

    const handle = await createIsolatedOpencode({} as never);

    expect(captured).toBeDefined();
    expect(captured).toContain('opencode-data-'); // 서버 전용 격리 디렉터리
    expect(existsSync(captured!)).toBe(true); // 스폰 시점엔 존재
    expect(process.env.XDG_DATA_HOME).toBe(before); // 호출 후 복원

    handle.server.close();
  });

  it('두 번 스폰하면 서로 다른 데이터 디렉터리를 쓴다(공유 SQLite 회피의 핵심)', async () => {
    const dirs: (string | undefined)[] = [];
    mockHandle((d) => dirs.push(d));

    const h1 = await createIsolatedOpencode({} as never);
    const h2 = await createIsolatedOpencode({} as never);

    expect(dirs[0]).toBeDefined();
    expect(dirs[1]).toBeDefined();
    expect(dirs[0]).not.toBe(dirs[1]);

    h1.server.close();
    h2.server.close();
  });

  it('server.close() 는 하위 server.close 를 호출하고 데이터 디렉터리를 제거한다', async () => {
    let dir: string | undefined;
    const innerClose = vi.fn();
    mockHandle((d) => (dir = d), innerClose);

    const handle = await createIsolatedOpencode({} as never);
    expect(existsSync(dir!)).toBe(true);

    handle.server.close();

    expect(innerClose).toHaveBeenCalledOnce();
    expect(existsSync(dir!)).toBe(false); // 디렉터리 정리됨
  });

  it('부팅(createOpencode) 실패 시 데이터 디렉터리를 정리하고 에러를 재전파하며 env 를 복원한다', async () => {
    const before = process.env.XDG_DATA_HOME;
    let dir: string | undefined;
    createOpencode.mockImplementation(async () => {
      dir = process.env.XDG_DATA_HOME; // launch 이전 동기 캡처 시점 모사
      throw new Error('boot fail: database is locked');
    });

    await expect(createIsolatedOpencode({} as never)).rejects.toThrow('boot fail');

    expect(dir).toBeDefined();
    expect(existsSync(dir!)).toBe(false); // 실패해도 누수 없음
    expect(process.env.XDG_DATA_HOME).toBe(before); // 복원
  });

  // 동시 생존 서버 수 제한(OOM 방지) — 모듈 기본값 MAX_LIVE_SERVERS=3(env 미설정) 기준.
  it('동시 생존 서버를 MAX_LIVE_SERVERS(기본 3)로 제한하고, close 로 슬롯이 나면 대기분이 진행한다', async () => {
    const resolvers: Array<() => void> = [];
    // createOpencode 를 수동 제어 — resolvers[i]() 를 호출해야 i 번째 부팅이 완료된다.
    createOpencode.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ client: {}, server: { url: 'http://x', close: vi.fn() } }));
        }),
    );

    // 모든 대기 중 마이크로태스크를 비운다(매크로태스크 경계) — async 계층 수에 둔감하게.
    const flush = () => new Promise((r) => setTimeout(r, 0));

    const p1 = createIsolatedOpencode({} as never);
    const p2 = createIsolatedOpencode({} as never);
    const p3 = createIsolatedOpencode({} as never);
    const p4 = createIsolatedOpencode({} as never); // 슬롯 초과 → 대기

    await flush();
    // 3 슬롯만 부팅에 진입하고 4번째는 슬롯을 못 얻어 createOpencode 를 아직 호출하지 못한다.
    expect(createOpencode).toHaveBeenCalledTimes(3);

    // 첫 서버 완료 후 close → 생존 슬롯 반납 → 대기하던 4번째가 부팅 진입.
    resolvers[0]();
    const h1 = await p1;
    h1.server.close();
    await flush();
    expect(createOpencode).toHaveBeenCalledTimes(4);

    // 정리 — 나머지 서버 완료 후 close 로 슬롯/디렉터리 반납.
    resolvers[1]();
    resolvers[2]();
    resolvers[3]();
    const rest = await Promise.all([p2, p3, p4]);
    rest.forEach((h) => h.server.close());
  });
});
