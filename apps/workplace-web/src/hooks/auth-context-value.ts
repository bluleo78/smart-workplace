import { createContext } from 'react';

import type { LoginFormData, SignupFormData } from '../lib/validations/auth';
import type { Membership, UserResponse } from '../types/auth';
import type { RoleResponse } from '../types/role';

export interface AuthContextValue {
  user: UserResponse | null;
  roles: RoleResponse[];
  isLoading: boolean;
  /** 로그아웃 정리가 진행 중이면 워크플로우 초안 쓰기를 막는다. */
  isLoggingOut: boolean;
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
  /**
   * 쓰기 성공을 서버 재요청 없이 세션 상태에 바로 반영한다(WP-1912) — 갱신(refreshUser)이 실패한 뒤에도
   * 아는 결과(이름·이메일·hasPassword 등)가 옛 값으로 되돌아 이 화면·레일 메뉴가 옛 값을 보여 주지 않게 한다.
   * 알지 못하는 필드는 넘기지 않는다 — 새 값만 고쳐 나머지는 그대로 둔다.
   */
  patchUser: (patch: Partial<UserResponse>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
