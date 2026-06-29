import { describe, expect, it, vi } from 'vitest';

// useAuth 훅을 모킹해 AuthContext 의존 없이 useAiAvailable 단위 테스트
vi.mock('./useAuth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from './useAuth';
import { useAiAvailable } from './useAiAvailable';

const mockUseAuth = vi.mocked(useAuth);

describe('useAiAvailable', () => {
  it('user.aiAvailable=true 이면 true 반환', () => {
    mockUseAuth.mockReturnValue({ user: { aiAvailable: true } } as never);
    expect(useAiAvailable()).toBe(true);
  });

  it('user.aiAvailable=false 이면 false 반환', () => {
    mockUseAuth.mockReturnValue({ user: { aiAvailable: false } } as never);
    expect(useAiAvailable()).toBe(false);
  });

  it('user=null 이면 보수적으로 false 반환', () => {
    mockUseAuth.mockReturnValue({ user: null } as never);
    expect(useAiAvailable()).toBe(false);
  });
});
