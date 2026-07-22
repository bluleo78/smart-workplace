// opencode 서버를 "격리된 데이터 디렉터리"로 스폰한다. opencode 는 세션 상태를 단일 SQLite
// (~/.local/share/opencode/opencode.db, WAL)에 저장하는데, 여러 opencode 서버 프로세스가 이
// 공유 DB 를 동시에 열면 부팅 시 'database is locked'(Server exited with code 1)로 한 프로세스가
// 크래시한다(opencode 는 다중 프로세스 동시 접근 미지원). 웜 풀(서로 다른 키의 서버들)과 풀 비대상
// (mail/messaging/home 의 매-요청 신규 스폰)이 동시에 뜨면 이 경합이 발생한다.
//
// 해법: 서버마다 고유 XDG_DATA_HOME 을 줘 각자 자기 opencode.db 를 쓰게 해 공유 자원 자체를 없앤다.
// 프로바이더 자격증명은 OPENCODE_CONFIG_CONTENT(config)로 주입되고 데이터 디렉터리(auth.json 없음)에
// 의존하지 않으므로, 디렉터리를 격리해도 인증은 깨지지 않는다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOpencode, type Config } from '@opencode-ai/sdk';

import type { OpencodeHandle } from './opencode-server-pool.js';

export async function createIsolatedOpencode(config: Config): Promise<OpencodeHandle> {
  // 이 서버 전용 데이터 디렉터리(빈 상태로 시작 → opencode 가 자기 DB 를 새로 만든다).
  const dataDir = mkdtempSync(join(tmpdir(), 'opencode-data-'));

  // createOpencodeServer 는 per-call env 옵션이 없고 스폰 시 {...process.env} 를 그대로 자식에 넘긴다.
  // 따라서 XDG_DATA_HOME 을 스폰 직전에 process.env 에 심는다. launch(자식 spawn + env 캡처)는
  // createOpencode 의 "동기 prefix"에서 실행되므로, createOpencode() 호출이 반환된 직후 복원해도
  // 캡처와 복원 사이에 await(yield)가 없어 동시 스폰이 서로의 값을 침범하지 않는다(JS 단일 스레드).
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dataDir;
  let booting: Promise<OpencodeHandle>;
  try {
    booting = createOpencode({ config, port: 0 });
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
  }

  let handle: OpencodeHandle;
  try {
    handle = await booting;
  } catch (e) {
    // 부팅 실패(포트/락/타임아웃 등) 시에도 디렉터리가 새지 않도록 정리한 뒤 재전파.
    rmSync(dataDir, { recursive: true, force: true });
    throw e;
  }

  // server.close() 를 감싸 서버 종료 시 데이터 디렉터리까지 제거한다. 풀 서버는 close 가 유휴 축출/
  // graceful shutdown 시점에 호출되므로, 이 래핑으로 디렉터리 수명이 서버 수명과 정확히 일치한다.
  const closeServer = handle.server.close.bind(handle.server);
  return {
    client: handle.client,
    server: {
      url: handle.server.url,
      close: () => {
        try {
          closeServer();
        } finally {
          rmSync(dataDir, { recursive: true, force: true });
        }
      },
    },
  };
}
