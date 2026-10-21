import { describe, expect, it } from 'vitest';

import { userScopedKey } from './userScopedKey';

describe('userScopedKey', () => {
  it('사용자·워크스페이스가 다르면 키가 다르다', () => {
    const a = userScopedKey('project-favorites', { userId: 1, tenantId: 1 });
    expect(a).toBe('project-favorites:1:1');
    expect(userScopedKey('project-favorites', { userId: 2, tenantId: 1 })).not.toBe(a);
    expect(userScopedKey('project-favorites', { userId: 1, tenantId: 2 })).not.toBe(a);
  });
  it('워크스페이스가 없으면 - 로 둔다', () => {
    expect(userScopedKey('calendar.layers', { userId: 3, tenantId: null })).toBe('calendar.layers:3:-');
  });
});
