// activeTenant 판독 단위 테스트 — refresh 결과 토큰으로 "테넌트가 바뀌었는지" 판단하는 분기(WP-341 후속).
import { describe, expect, it } from 'vitest';

import { tenantChangedSince, tenantClaimOf } from './activeTenant';

/** 서명 없는 테스트용 JWT — payload 만 base64url 로 인코딩한다(판독은 서명을 검증하지 않는다). */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
}

const acme = { tenantId: 10, tenantName: 'Acme', tenantSlug: 'acme' };

describe('tenantClaimOf', () => {
  it('tenant 클레임이 있으면 그 id', () => {
    expect(tenantClaimOf(jwt({ sub: '1', tenant: 10 }))).toBe(10);
  });

  it('JWT 이지만 tenant 클레임이 없으면 null(tenant-less)', () => {
    expect(tenantClaimOf(jwt({ sub: '1' }))).toBeNull();
  });

  it('JWT 가 아니거나 비었으면 undefined(판단 불가)', () => {
    expect(tenantClaimOf('mock-access-token-12345')).toBeUndefined();
    expect(tenantClaimOf('a.!!!.c')).toBeUndefined();
    expect(tenantClaimOf(null)).toBeUndefined();
    expect(tenantClaimOf(jwt({ tenant: '10' }))).toBeUndefined();
  });
});

describe('tenantChangedSince', () => {
  const globex = { tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' };

  it('직전 메모리 토큰과 같은 테넌트면 변화 없음', () => {
    expect(tenantChangedSince(jwt({ tenant: 10 }), jwt({ tenant: 10 }), acme)).toBe(false);
  });

  it('직전 메모리 토큰과 다른 테넌트로 이어 가면 변화', () => {
    expect(tenantChangedSince(jwt({ tenant: 20 }), jwt({ tenant: 10 }), acme)).toBe(true);
  });

  it('쓰던 테넌트가 있었는데 tenant-less 가 되면 변화', () => {
    expect(tenantChangedSince(jwt({}), jwt({ tenant: 10 }), acme)).toBe(true);
  });

  it('다중 탭: 다른 탭이 보관값을 이미 새 테넌트로 바꿔도 이 탭의 메모리 토큰 기준으로 변화를 잡는다', () => {
    expect(tenantChangedSince(jwt({ tenant: 20 }), jwt({ tenant: 10 }), globex)).toBe(true);
    // 다른 탭이 tenant-less 로 보관값을 지운 경우도 마찬가지.
    expect(tenantChangedSince(jwt({}), jwt({ tenant: 10 }), null)).toBe(true);
  });

  it('보관값이 메모리 토큰과 어긋나도(동기화 실패) 메모리 토큰과 같으면 변화 없음 — 반복 리로드 방지', () => {
    expect(tenantChangedSince(jwt({ tenant: 10 }), jwt({ tenant: 10 }), null)).toBe(false);
  });

  it('직전 메모리 토큰이 없거나 판독 불가면 보관된 활성 테넌트로 대체한다', () => {
    expect(tenantChangedSince(jwt({ tenant: 20 }), null, acme)).toBe(true);
    expect(tenantChangedSince(jwt({ tenant: 10 }), 'mock-access-token-12345', acme)).toBe(false);
    // 보관값 없음 + tenant-less 는 선택 전 상태 그대로.
    expect(tenantChangedSince(jwt({}), null, null)).toBe(false);
  });

  it('새 토큰이 판독 불가면 변화 없음으로 본다(불투명 mock 토큰 포함)', () => {
    expect(tenantChangedSince('mock-access-token-12345', jwt({ tenant: 10 }), acme)).toBe(false);
  });
});
