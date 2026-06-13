import { createContext } from 'react';

import type { LoginFormData, SignupFormData } from '../lib/validations/auth';
import type { Membership, UserResponse } from '../types/auth';
import type { RoleResponse } from '../types/role';

export interface AuthContextValue {
  user: UserResponse | null;
  roles: RoleResponse[];
  isLoading: boolean;
  isAuthenticated: boolean;
  /** 현재 활성 워크스페이스(테넌트). 미선택/무소속이면 null. */
  activeTenant: Membership | null;
  /**
   * 로그인 후 테넌트 선택이 필요한 경우(다중소속)의 선택지.
   * null 이면 선택 대기 아님. LoginPage 가 이 값으로 선택 카드를 렌더한다.
   */
  tenantOptions: Membership[] | null;
  login: (data: LoginFormData) => Promise<void>;
  signup: (data: SignupFormData) => Promise<void>;
  logout: () => Promise<void>;
  /** 테넌트 선택/전환 — tenant-scoped 토큰 재발급 후 루트로 전체 리로드. */
  selectTenant: (membership: Membership) => Promise<void>;
  hasRole: (roleName: string) => boolean;
  isAdmin: boolean;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
