// Task14(#627) — opencode 러너 웜 서버 풀. OpencodeRunner.stream() 이 요청마다 opencode 서버
// 프로세스를 새로 스폰했다 죽이는 대신(스폰 자체가 ~380~400ms), hostBridge 를 쓰지 않는 프로필
// (assistant/chat/issue)에 한해 이 모듈이 서버 프로세스를 키(agentId+profile+onBehalfOfId+model)
// 별로 재사용한다. bridge-registry.ts 와 동일한 패턴 — 모듈 스코프 Map, 프로세스 재시작 시
// 초기화되어도 무방(영속화 불필요). 설계 근거: docs/superpowers/specs/2026-07-03-opencode-warm-cache-design.md
import type { createOpencode } from '@opencode-ai/sdk';

import { log } from '../logger.js';
import { hasLiveSlotWaiters, registerIdleReclaimer } from './opencode-spawn.js';

export type OpencodeHandle = Awaited<ReturnType<typeof createOpencode>>;
export type SpawnOpencode = () => Promise<OpencodeHandle>;

export const IDLE_TTL_MS = 5 * 60 * 1000;
// 웜 풀에 유지할 최대 서버 수. opencode 서버 하나가 ~380MB(실측)를 상주하므로, 생존 서버 총량
// 상한(OPENCODE_MAX_LIVE_SERVERS, opencode-spawn.ts, 기본 3)보다 작게 둔다 — 그래야 웜 풀이 생존
// 슬롯을 전부 점유해 풀 비대상(mail/messaging/home) 요청이 슬롯을 못 얻고 굶는 상황을 막고,
// 새 키가 오면 enforceCapacity 가 유휴 풀 서버를 축출해 슬롯을 비운다. 기본 2, env 로 조정.
export const MAX_POOL_SIZE = Math.max(1, Number(process.env.OPENCODE_MAX_POOL_SIZE ?? '2') || 2);

interface PoolEntry {
  handle: OpencodeHandle;
  useCount: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const pool = new Map<string, PoolEntry>();
// 진행 중인 스폰(아직 pool 에 등록 전)을 키별로 공유하기 위한 맵. 동일 키에 동시 miss 가 여러 건
// 들어와도 spawn() 을 한 번만 호출하게 해, 여분의 서버가 생성됐다가 map 에서 덮여 close 없이
// 유실(프로세스+데이터 디렉터리 누수)되는 레이스를 방지한다.
const inflight = new Map<string, Promise<OpencodeHandle>>();

// close() 자체가 던져도(이미 죽은 프로세스 등) 다른 항목 정리를 막지 않도록 흡수한다.
function closeQuietly(handle: OpencodeHandle): void {
  try {
    handle.server.close();
  } catch (e) {
    log.error('opencode-server-pool', 'pool_close_error', { error: e instanceof Error ? e.message : String(e) });
  }
}

// 유휴(useCount 0) 항목 중 lastUsedAt 이 가장 오래된 것부터 축출해 MAX_POOL_SIZE 를 지킨다.
// 전부 사용 중이면(축출 대상 없음) 일시적으로 상한을 넘겨도 강제 종료하지 않는다 — 진행 중인
// 요청을 끊는 것보다 일시적인 초과 허용이 안전하다(소프트 캡).
function enforceCapacity(): void {
  if (pool.size <= MAX_POOL_SIZE) return;
  const idleKeys = [...pool.entries()]
    .filter(([, e]) => e.useCount === 0)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    .map(([key]) => key);
  for (const key of idleKeys) {
    if (pool.size <= MAX_POOL_SIZE) break;
    evictServer(key);
  }
}

// key 에 해당하는 서버가 풀에 있으면 재사용(useCount++, 유휴 타이머 해제), 없으면 spawn() 으로
// 새로 띄워 풀에 등록한다. 반환된 handle 은 반드시 releaseServer(key) 또는 evictServer(key) 로
// 짝을 맞춰야 한다 — 안 그러면 useCount 가 잠긴 채로 남아 유휴 축출이 영영 동작하지 않는다.
export async function acquireServer(key: string, spawn: SpawnOpencode): Promise<OpencodeHandle> {
  const existing = pool.get(key);
  if (existing) {
    existing.useCount += 1;
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    log.info('opencode-server-pool', 'pool_hit', { key, useCount: existing.useCount });
    return existing.handle;
  }

  // 같은 키로 이미 스폰이 진행 중이면 그것을 공유한다(중복 스폰 방지). 완료를 기다린 뒤 재진입하면
  // 위 pool_hit 경로로 합류해 useCount 를 올린다. 스폰이 실패했다면(pool 에 엔트리 없음) 재진입한
  // 이 호출이 새 스폰을 맡는다. 아래 pool.set/enforceCapacity 가 await 없이 한 마이크로태스크에
  // 이어지므로, 재진입 시점엔 항상 "등록됨(hit)" 또는 "실패로 미등록(새 스폰)" 둘 중 하나로 확정된다.
  const pending = inflight.get(key);
  if (pending) {
    log.info('opencode-server-pool', 'pool_spawn_join', { key });
    await pending.catch(() => undefined);
    return acquireServer(key, spawn);
  }

  log.info('opencode-server-pool', 'pool_miss', { key });
  const booting = spawn();
  inflight.set(key, booting);
  let handle: OpencodeHandle;
  try {
    handle = await booting;
  } finally {
    inflight.delete(key);
  }
  pool.set(key, { handle, useCount: 1, lastUsedAt: Date.now(), idleTimer: null });
  enforceCapacity();
  return handle;
}

// 사용 종료 — useCount 를 낮추고, 0 이 되면 유휴 타이머(IDLE_TTL_MS)를 시작한다. 그 사이
// acquireServer 로 재사용되지 않으면 서버를 close 하고 풀에서 제거한다.
export function releaseServer(key: string): void {
  const entry = pool.get(key);
  if (!entry) return; // evictServer 로 이미 제거된 경우(크래시 감지 경로) — no-op.

  entry.useCount = Math.max(0, entry.useCount - 1);
  if (entry.useCount > 0) return;

  // 요청이 끝나 유휴가 됐다. 생존 슬롯을 기다리는 스폰이 있으면(메모리 압박) 웜으로 붙잡지 않고
  // 즉시 축출해 permit 을 그 대기자에게 넘긴다 — 안 그러면 이 서버가 permit 을 idle 상태로 최대
  // IDLE_TTL_MS(5분) 점유해 대기자가 그만큼 hang 한다(완료→대기자 연결 부재, advisor 지적). 여유가
  // 있으면(대기자 없음) 기존대로 유휴 타이머로 웜 상태를 유지한다.
  if (hasLiveSlotWaiters()) {
    evictServer(key); // close → 생존 슬롯 반납(대기자에게 전달)
    return;
  }

  entry.lastUsedAt = Date.now();
  entry.idleTimer = setTimeout(() => {
    const current = pool.get(key);
    if (!current || current.useCount > 0) return; // 그 사이 재사용됐으면 아무 것도 하지 않음.
    pool.delete(key);
    closeQuietly(current.handle);
    log.info('opencode-server-pool', 'pool_idle_evict', { key });
  }, IDLE_TTL_MS);
}

// 크래시/에러 감지 시 즉시 폐기 — useCount 와 무관하게 풀에서 제거하고 close 시도(실패 무시).
// 다음 acquireServer(같은 key) 는 캐시 미스로 처리되어 새로 spawn 한다.
export function evictServer(key: string): void {
  const entry = pool.get(key);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  pool.delete(key);
  closeQuietly(entry.handle);
  log.info('opencode-server-pool', 'pool_evict', { key });
}

// 생존 서버 슬롯(opencode-spawn.ts 의 세마포어) 압박 시 호출 — 유휴(useCount 0)인 풀 서버 중 가장
// 오래된(LRU) 것을 축출(close→permit 반납)해 슬롯을 하나 비운다. 하나 축출하면 true, 유휴 서버가
// 하나도 없으면(전부 사용 중) false. 이 함수를 스폰 압박 경로에 연결해, 웜 풀이 permit 을 idle
// 상태로 무기한 점유하며 풀 비대상 요청을 굶기는 기아를 방지한다(demand-driven eviction).
export function reclaimIdleServer(): boolean {
  let lruKey: string | undefined;
  let lruAt = Infinity;
  for (const [key, entry] of pool) {
    if (entry.useCount === 0 && entry.lastUsedAt < lruAt) {
      lruAt = entry.lastUsedAt;
      lruKey = key;
    }
  }
  if (lruKey === undefined) return false; // 축출 가능한 유휴 서버 없음(전부 mid-request)
  evictServer(lruKey); // idleTimer 정리 + pool 제거 + close(→ 생존 슬롯 반납)
  log.info('opencode-server-pool', 'pool_reclaim_idle', { key: lruKey });
  return true;
}

// 스폰 압박 시 유휴 풀 서버를 반납하도록 opencode-spawn 의 세마포어에 축출자를 등록한다.
registerIdleReclaimer(reclaimIdleServer);

// ai-agent 프로세스 자체 종료(graceful shutdown) 시 전체 정리 — 안 하면 좀비 opencode/stdio
// 자식 프로세스가 남는다.
export function closeAllServers(): void {
  for (const [, entry] of pool) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    closeQuietly(entry.handle);
  }
  pool.clear();
}

// 테스트 전용 — 모듈 스코프 Map 이 테스트 간 누수되지 않도록 초기화(타이머도 함께 정리).
export function __resetPoolForTest(): void {
  for (const entry of pool.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
  }
  pool.clear();
}
