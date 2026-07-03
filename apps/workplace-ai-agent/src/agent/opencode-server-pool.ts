// Task14(#627) — opencode 러너 웜 서버 풀. OpencodeRunner.stream() 이 요청마다 opencode 서버
// 프로세스를 새로 스폰했다 죽이는 대신(스폰 자체가 ~380~400ms), hostBridge 를 쓰지 않는 프로필
// (assistant/chat/issue)에 한해 이 모듈이 서버 프로세스를 키(agentId+profile+onBehalfOfId+model)
// 별로 재사용한다. bridge-registry.ts 와 동일한 패턴 — 모듈 스코프 Map, 프로세스 재시작 시
// 초기화되어도 무방(영속화 불필요). 설계 근거: docs/superpowers/specs/2026-07-03-opencode-warm-cache-design.md
import type { createOpencode } from '@opencode-ai/sdk';

import { log } from '../logger.js';

export type OpencodeHandle = Awaited<ReturnType<typeof createOpencode>>;
export type SpawnOpencode = () => Promise<OpencodeHandle>;

export const IDLE_TTL_MS = 5 * 60 * 1000;
export const MAX_POOL_SIZE = 16;

interface PoolEntry {
  handle: OpencodeHandle;
  useCount: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const pool = new Map<string, PoolEntry>();

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

  log.info('opencode-server-pool', 'pool_miss', { key });
  const handle = await spawn();
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
