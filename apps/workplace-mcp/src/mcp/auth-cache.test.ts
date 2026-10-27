// 토큰 검증 성공 기억(WP-1013) — 만료·상한·테넌트 구분·동시 검증 묶기. 시각은 주입한 now 로 움직여 실제 시간에 기대지 않는다.
import { describe, expect, it, vi } from 'vitest';

import { createAuthCache } from './auth-cache.js';

const ok = () => vi.fn(() => Promise.resolve());

describe('createAuthCache', () => {
  it('성공한 검증은 TTL 안에서만 다시 묻지 않는다', async () => {
    let t = 1_000;
    const cache = createAuthCache({ ttlMs: 100, now: () => t });
    const check = ok();
    await cache.verify('swp_a', undefined, check);
    t += 99;
    await cache.verify('swp_a', undefined, check);
    expect(check).toHaveBeenCalledTimes(1);
    t += 1;
    await cache.verify('swp_a', undefined, check);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('실패는 기억하지 않아 다음 요청에서 다시 검증한다', async () => {
    const cache = createAuthCache();
    await expect(cache.verify('swp_a', undefined, () => Promise.reject(new Error('401')))).rejects.toThrow('401');
    const check = ok();
    await cache.verify('swp_a', undefined, check);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('테넌트 헤더가 다르면 다른 검증으로 본다', async () => {
    const cache = createAuthCache();
    const check = ok();
    await cache.verify('ak_a', '7', check);
    await cache.verify('ak_a', '7', check);
    await cache.verify('ak_a', '8', check);
    await cache.verify('ak_a', undefined, check);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('같은 조합의 검증이 진행 중이면 한 번만 부르고 결과를 함께 받는다', async () => {
    const cache = createAuthCache();
    let release!: () => void;
    const check = vi.fn(() => new Promise<void>((r) => (release = r)));
    const both = Promise.all([cache.verify('swp_a', undefined, check), cache.verify('swp_a', undefined, check)]);
    release();
    await both;
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('상한을 넘으면 가장 오래 넣은 것부터 버린다', async () => {
    const cache = createAuthCache({ maxEntries: 2 });
    const checks = { a: ok(), b: ok(), c: ok() };
    await cache.verify('swp_a', undefined, checks.a);
    await cache.verify('swp_b', undefined, checks.b);
    await cache.verify('swp_c', undefined, checks.c);
    // a 는 가장 오래돼 버려져 만료 전이어도 다시 검증하고, b 는 남아 있다.
    await cache.verify('swp_a', undefined, checks.a);
    await cache.verify('swp_c', undefined, checks.c);
    expect(checks.a).toHaveBeenCalledTimes(2);
    expect(checks.c).toHaveBeenCalledTimes(1);
  });
});
