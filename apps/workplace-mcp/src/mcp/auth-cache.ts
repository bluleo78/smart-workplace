// src/mcp/auth-cache.ts — 토큰 검증 성공 기억(WP-1013).
// 모든 MCP 요청이 토큰을 검증하게 되면서(전에는 initialize 만) 요청마다 /auth/me 를 부르지 않도록, 검증에 성공한 토큰을 잠깐 기억한다.
// 실패는 기억하지 않는다 — 토큰은 외부가 마음대로 보내는 값이라 실패까지 쌓으면 그 자체가 메모리를 키우는 통로가 된다. 같은 이유로 크기에 상한을 둔다.
import { createHash } from 'node:crypto';

/** 성공을 기억하는 시간 — 폐기된 토큰도 이만큼은 더 통과할 수 있다(도구 호출은 어차피 workplace-api 가 다시 막는다). */
const AUTH_CACHE_TTL_MS = 60_000;
/** 기억하는 토큰 수 상한 — 넘으면 가장 오래 쓰지 않은 것부터 버린다. */
const AUTH_CACHE_MAX_ENTRIES = 1_000;

export interface AuthCache {
  /**
   * 이 토큰·테넌트 조합을 검증한다. TTL 안에 성공한 적이 있으면 check 를 부르지 않고 통과한다.
   * 같은 조합의 검증이 진행 중이면 그 결과를 함께 기다린다(연결 직후 initialize·tools/list 가 몰려도 /auth/me 는 한 번).
   * check 가 던지면 그대로 던진다 — 실패는 기억하지 않는다.
   */
  verify(token: string, tenantId: string | undefined, check: () => Promise<unknown>): Promise<void>;
}

/** 원문 토큰을 메모리에 쥐고 있지 않도록 해시를 키로 쓴다. 테넌트 헤더(ak_ 전용)가 다르면 다른 검증이다. */
function keyOf(token: string, tenantId?: string): string {
  return createHash('sha256').update(`${token}\n${tenantId ?? ''}`).digest('hex');
}

export function createAuthCache(opts: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): AuthCache {
  const ttlMs = opts.ttlMs ?? AUTH_CACHE_TTL_MS;
  const maxEntries = opts.maxEntries ?? AUTH_CACHE_MAX_ENTRIES;
  const now = opts.now ?? Date.now;
  // 키 → 만료 시각. Map 은 넣은 순서를 지키고 쓸 때마다 다시 넣어, 첫 키가 가장 오래 쓰지 않은 항목이다.
  const expiresAt = new Map<string, number>();
  // 키 → 진행 중인 검증. 끝나면(성공·실패 모두) 지운다.
  const inFlight = new Map<string, Promise<void>>();

  /** 지웠다 넣어 가장 최근 항목으로 옮긴다. 새 키로 상한에 닿으면 가장 오래 쓰지 않은 것을 버린다. */
  function touch(key: string, exp: number): void {
    expiresAt.delete(key);
    if (expiresAt.size >= maxEntries) expiresAt.delete(expiresAt.keys().next().value as string);
    expiresAt.set(key, exp);
  }

  return {
    verify(token, tenantId, check) {
      const key = keyOf(token, tenantId);
      const exp = expiresAt.get(key);
      if (exp !== undefined && exp > now()) {
        touch(key, exp);
        return Promise.resolve();
      }
      const pending = inFlight.get(key);
      if (pending) return pending;
      const run = check()
        .then(() => touch(key, now() + ttlMs))
        .finally(() => inFlight.delete(key));
      inFlight.set(key, run);
      return run;
    },
  };
}
