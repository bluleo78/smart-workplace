// opencode 서버를 "격리된 데이터 디렉터리"로 스폰한다. opencode 는 세션 상태를 단일 SQLite
// (~/.local/share/opencode/opencode.db, WAL)에 저장하는데, 여러 opencode 서버 프로세스가 이
// 공유 DB 를 동시에 열면 부팅 시 'database is locked'(Server exited with code 1)로 한 프로세스가
// 크래시한다(opencode 는 다중 프로세스 동시 접근 미지원). 웜 풀(서로 다른 키의 서버들)과 풀 비대상
// (mail/messaging/home 의 매-요청 신규 스폰)이 동시에 뜨면 이 경합이 발생한다.
//
// 해법: 서버마다 고유 XDG_DATA_HOME 을 줘 각자 자기 opencode.db 를 쓰게 해 공유 자원 자체를 없앤다.
// 프로바이더 자격증명은 config 로 주입되고 데이터 디렉터리(auth.json 없음)에 의존하지 않으므로,
// 디렉터리를 격리해도 인증은 깨지지 않는다.
//
// 단 에이전트 프롬프트는 config 에서 빼 그 격리 디렉터리의 파일로 두고 `{file:경로}` 로 가리킨다(WP-1319).
// SDK(createOpencodeServer)는 config 전체를 OPENCODE_CONFIG_CONTENT 한 칸에 JSON 으로 넣는데, 시스템 프롬프트 +
// 서브에이전트 9개 프롬프트가 Linux 의 환경 변수 문자열 한도(MAX_ARG_STRLEN 128KB)를 넘어 spawn 이 E2BIG 로 실패했다.
// config 전체를 파일(OPENCODE_CONFIG)로 넘기지 않는 이유: 그 파일은 프로젝트·.opencode 설정보다 먼저 읽혀 우선순위가 낮아지고
// (도구 차단·권한 거부를 덮어쓸 수 있다), 자격증명이 디스크에 남는다. 프롬프트만 빼면 나머지(자격증명·도구·권한)는
// 지금처럼 가장 나중에 읽히는 OPENCODE_CONFIG_CONTENT 로 가고, 디스크에는 프롬프트만 남는다(1.19.5 실측: `{file:}` 은
// 원문을 그대로 읽고 그 안의 `{env:…}` 같은 글자는 치환하지 않는다).
//
// 추가로 "동시 생존 opencode 서버 수"를 세마포어로 제한한다. 실측상 opencode(bun) 서버 하나가
// 부팅 후에도 ~수백MB(RSS ≈ 380MB, host 기준)를 상주하므로, 웜 풀 누적 + 풀 비대상 매-요청 스폰이
// 겹치면 컨테이너/호스트가 OOM(SIGKILL, exit code null)에 빠진다. 부팅 순간이 아니라 "살아있는
// 서버 총량"이 메모리를 지배하므로(부팅 RSS ≈ idle RSS), 슬롯을 부팅 직전에 얻어 서버 종료(close)
// 시점에 반납한다 → 점유 기간 = 서버 수명 = 실제 메모리 점유 기간. 한도는 env 로 조정한다.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOpencode, type Config } from '@opencode-ai/sdk';

import type { OpencodeHandle } from './opencode-server-pool.js';
import { Semaphore } from './semaphore.js';

// 동시에 살아있을 수 있는 opencode 서버 수 상한. 서버당 ~380MB(실측) 이므로 가용 메모리에 맞춰
// (권장: (컨테이너_메모리MB - 250) / 450) 조정한다. 기본 3(≈ 1.2GB peak).
const MAX_LIVE_SERVERS = Math.max(1, Number(process.env.OPENCODE_MAX_LIVE_SERVERS ?? '3') || 3);
const liveServers = new Semaphore(MAX_LIVE_SERVERS);

// 생존 슬롯 압박(모든 permit 점유) 시, 유휴(요청 없음이지만 아직 살아있는) 웜 풀 서버를 축출해
// 메모리+슬롯을 반납받기 위한 훅. 풀 모듈(opencode-server-pool.ts)이 자신을 로드할 때 등록한다.
// 미등록(풀 미사용)이면 축출 대상 자체가 없다는 뜻이므로 그냥 대기한다. 반환 true = 하나 축출함.
// ⚠️ 이 훅이 없으면: 웜 풀 서버가 permit 을 idle 상태로 무기한 점유(재사용이 TTL 리셋)해, 풀
//    비대상(mail 등) 스폰이 permit 을 영영 못 얻어 무기한 hang 한다(실측 위험, advisor 지적).
let reclaimIdleServer: (() => boolean) | null = null;
export function registerIdleReclaimer(fn: () => boolean): void {
  reclaimIdleServer = fn;
}

// 생존 슬롯을 대기 중인(park 된) 스폰이 있는지. 풀(releaseServer)이 요청 완료로 유휴가 될 때,
// 대기자가 있으면 웜으로 붙잡지 않고 즉시 서버를 축출해 permit 을 넘기도록 판단하는 데 쓴다.
// 이게 없으면 park 된 스폰이 유휴 서버의 IDLE_TTL_MS(5분) 만료까지 hang 한다(advisor 지적).
export function hasLiveSlotWaiters(): boolean {
  return liveServers.queuedCount > 0;
}

// 생존 슬롯을 확보한다. 여유가 있으면 즉시, 없으면 유휴 풀 서버를 축출해 슬롯을 만든다. 축출할
// 유휴 서버가 하나도 없으면(전부 mid-request) 반납될 때까지 대기 — 이 경우는 일시적이며 각 요청의
// 타임아웃으로 결국 반납된다.
async function acquireLiveSlot(): Promise<void> {
  if (liveServers.tryAcquire()) return;
  // 유휴 풀 서버를 하나씩 축출(→ 그 서버의 close 가 permit 반납)하며 슬롯을 노린다. 축출로 반납된
  // 슬롯을 다른 대기자가 채갔으면 다시 축출을 시도한다.
  while (reclaimIdleServer?.()) {
    if (liveServers.tryAcquire()) return;
  }
  await liveServers.acquire();
}

/** 생존 슬롯이 없어 바로 띄우지 못했다(tryOnly 스폰) — 호출자는 기다리지 않고 포기한다. */
export class NoLiveSlotError extends Error {
  constructor() {
    super('opencode 생존 서버 슬롯이 없어 띄우지 않았습니다');
  }
}

/**
 * 스폰 선택 — 기본(생략)은 실행 경로와 같다(슬롯을 기다리고 유휴 풀 서버를 축출해서라도 띄운다).
 * tryOnly: 남는 슬롯이 있을 때만 띄우고 없으면 NoLiveSlotError(축출·대기 없음). 모델 목록의 생각의 깊이 조회(WP-1322)처럼
 *   드롭다운을 붙잡는 짧은 부가 조회가 실행 중인 대화의 웜 서버를 밀어내거나 큐에 줄 서지 않게 한다.
 * startupTimeoutMs: 서버 부팅 대기 상한(SDK createOpencode timeout, 기본 SDK 값).
 */
export interface SpawnOptions {
  tryOnly?: boolean;
  startupTimeoutMs?: number;
}

export async function createIsolatedOpencode(config: Config, opts: SpawnOptions = {}): Promise<OpencodeHandle> {
  // 생존 서버 슬롯 확보 — 상한 도달 시 유휴 풀 서버 축출로 슬롯을 만들거나(acquireLiveSlot),
  // 전부 mid-request 면 반납될 때까지 대기(OOM 대신 큐잉). tryOnly 면 남는 슬롯만 쓴다.
  // 실패/종료 경로 어디서든 정확히 1회만 반납되도록 가드한다(이중 반납 = 슬롯 과다 → 상한 붕괴).
  if (opts.tryOnly) {
    if (!liveServers.tryAcquire()) throw new NoLiveSlotError();
  } else {
    await acquireLiveSlot();
  }
  let permitReleased = false;
  const releasePermit = (): void => {
    if (permitReleased) return;
    permitReleased = true;
    liveServers.release();
  };

  // 이 서버 전용 데이터 디렉터리(빈 상태로 시작 → opencode 가 자기 DB 를 새로 만든다). 프롬프트 파일도 여기 둔다(파일 머리 주석).
  let prepared: { dataDir: string; spawnConfig: Config };
  try {
    prepared = prepareDataDir(config);
  } catch (e) {
    // 디스크 쓰기 실패(ENOSPC 등)에도 슬롯이 새면 상한만큼 실패한 뒤 모든 스폰이 영영 대기한다 — 반납하고 재전파.
    releasePermit();
    throw e;
  }
  const { dataDir, spawnConfig } = prepared;

  // createOpencodeServer 는 per-call env 옵션이 없고 스폰 시 {...process.env} 를 그대로 자식에 넘긴다.
  // 따라서 XDG_DATA_HOME 을 스폰 직전에 process.env 에 심는다. launch(자식 spawn + env 캡처)는
  // createOpencode 의 "동기 prefix"에서 실행되므로, createOpencode() 호출이 반환된 직후 복원해도
  // 캡처와 복원 사이에 await(yield)가 없어 동시 스폰이 서로의 값을 침범하지 않는다(JS 단일 스레드).
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dataDir;
  let booting: Promise<OpencodeHandle>;
  try {
    booting = createOpencode({
      config: spawnConfig,
      port: 0,
      ...(opts.startupTimeoutMs ? { timeout: opts.startupTimeoutMs } : {}),
    });
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
  }

  let handle: OpencodeHandle;
  try {
    handle = await booting;
  } catch (e) {
    // 부팅 실패(포트/락/타임아웃 등) 시에도 디렉터리가 새지 않도록 정리하고 슬롯을 반납한 뒤 재전파.
    rmSync(dataDir, { recursive: true, force: true });
    releasePermit();
    throw e;
  }

  // server.close() 를 감싸 서버 종료 시 데이터 디렉터리 제거 + 생존 슬롯 반납을 함께 처리한다.
  // 풀 서버는 close 가 유휴 축출/graceful shutdown 시점에 호출되므로, 이 래핑으로 디렉터리·슬롯
  // 수명이 서버 수명과 정확히 일치한다.
  const closeServer = handle.server.close.bind(handle.server);
  return {
    client: handle.client,
    server: {
      url: handle.server.url,
      close: () => {
        try {
          closeServer();
        } finally {
          try {
            rmSync(dataDir, { recursive: true, force: true });
          } finally {
            releasePermit();
          }
        }
      },
    },
  };
}

/** 서버 전용 데이터 디렉터리를 만들고 프롬프트를 그 안 파일로 뺀 config 를 돌려준다. 실패하면 만든 디렉터리를 지우고 재전파. */
function prepareDataDir(config: Config): { dataDir: string; spawnConfig: Config } {
  const dataDir = mkdtempSync(join(tmpdir(), 'opencode-data-'));
  try {
    return { dataDir, spawnConfig: externalizeAgentPrompts(config, dataDir) };
  } catch (e) {
    rmSync(dataDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * 에이전트 프롬프트를 dir 의 파일로 쓰고 config 에는 `{file:<절대 경로>}` 만 남긴 사본을 돌려준다(WP-1319 — 파일 머리 주석).
 * 파일 이름은 순번으로 짓는다(에이전트 이름을 경로에 넣지 않는다). 원본 config 는 바꾸지 않는다.
 */
function externalizeAgentPrompts(config: Config, dir: string): Config {
  if (!config.agent) return config;
  const agent = Object.fromEntries(
    Object.entries(config.agent).map(([name, def], idx) => {
      if (!def?.prompt) return [name, def];
      const file = join(dir, `agent-prompt-${idx}.md`);
      writeFileSync(file, def.prompt, { mode: 0o600 });
      return [name, { ...def, prompt: `{file:${file}}` }];
    }),
  );
  return { ...config, agent };
}
