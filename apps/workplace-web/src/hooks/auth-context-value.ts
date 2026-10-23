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
  /**
   * 로그인/선택 화면에 띄울 세션 안내(WP-341 후속) — 쓰던 워크스페이스를 잃어 선택이 필요하거나, 남은 워크스페이스가 없어 로그아웃된 경우.
   * null 이면 안내 없음.
   */
  authNotice: string | null;
  /**
   * 앱을 열 때 세션 확인(refresh·소속·내 정보)이 일시 오류(5xx·네트워크)로 실패했는가(WP-859). 세션 표시는 남겨 두고
   * 보호 라우트가 로그인 화면 대신 「서버에 연결하지 못했습니다 — 다시 시도」를 보인다. 401·403 같은 거절은 여기 오지 않고 로그아웃된다.
   */
  connectionError: boolean;
  /** connectionError 상태에서 세션 확인을 다시 한다. */
  retryAuth: () => void;
  login: (data: LoginFormData) => Promise<void>;
  signup: (data: SignupFormData) => Promise<void>;
  logout: () => Promise<void>;
  /** 테넌트 전환 — 토큰 재발급 후 redirectTo(기본 '/')로 전체 리로드. 알림 탭 이동은 목적지를 넘긴다. */
  selectTenant(membership: Membership, redirectTo?: string): Promise<void>;
  /** WP-48 SSO 완료 — refresh 쿠키로 세션 확보 후 진입('entered')/선택 필요('select')/워크스페이스 없음('none'). */
  completeSsoLogin: () => Promise<'entered' | 'select' | 'none'>;
  hasRole: (roleName: string) => boolean;
  isAdmin: boolean;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
