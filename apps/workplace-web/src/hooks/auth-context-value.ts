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
  /** 테넌트 전환 — 토큰 재발급 후 redirectTo(기본 '/')로 전체 리로드. 알림 탭 이동은 목적지를 넘긴다. */
  selectTenant(membership: Membership, redirectTo?: string): Promise<void>;
  hasRole: (roleName: string) => boolean;
  isAdmin: boolean;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
