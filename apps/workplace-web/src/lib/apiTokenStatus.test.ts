import { describe, expect, it } from 'vitest';

import { apiTokenStatus } from './apiTokenStatus';

const NOW = Date.parse('2026-10-22T00:00:00Z');

describe('apiTokenStatus', () => {
  it('만료일이 지났으면 폐기 전이어도 만료됨', () => {
    expect(apiTokenStatus({ revokedAt: null, expiresAt: '2026-10-21T00:00:00Z' }, NOW)).toBe('expired');
  });
  it('만료일 전이거나 무기한이면 활성', () => {
    expect(apiTokenStatus({ revokedAt: null, expiresAt: '2026-10-23T00:00:00Z' }, NOW)).toBe('active');
    expect(apiTokenStatus({ revokedAt: null, expiresAt: null }, NOW)).toBe('active');
  });
  it('폐기됐으면 만료 여부와 상관없이 폐기됨', () => {
    expect(apiTokenStatus({ revokedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-02T00:00:00Z' }, NOW)).toBe('revoked');
  });
});
