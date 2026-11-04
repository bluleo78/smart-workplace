import type {
  LoginRequest,
  LoginResponse,
  Membership,
  SignupRequest,
  TokenResponse,
  UserResponse,
} from '../types/auth';
import { client } from './client';

export const authApi = {
  signup: (data: SignupRequest) => client.post<UserResponse>('/auth/signup', data),
  // 회원가입 가용성 조회(공개) — 부트스트랩(사용자 0명) 단계에서만 true.
  // 가입 화면/링크 노출 제어용. 첫 사용자 생성 이후 false 로 잠긴다.
  signupAvailable: () =>
    client.get<{ available: boolean }>('/auth/signup-available').then((r) => r.data.available),
  // 1단계 로그인 — tenant-less access + 선택 가능한 멤버십 목록 반환
  login: (data: LoginRequest) => client.post<LoginResponse>('/auth/login', data),
  // 2단계 — 테넌트 선택/전환(tenant-scoped 토큰 재발급)
  selectTenant: (tenantId: number) =>
    client.post<TokenResponse>('/auth/select-tenant', { tenantId }),
  // 내 활성 멤버십 목록(전환 팝오버에서 lazy fetch)
  memberships: () => client.get<Membership[]>('/auth/memberships'),
  // WP-48 SSO 사용 가능 여부(공개) — 로그인 화면의 Microsoft 버튼 노출용.
  ssoStatus: () => client.get<{ m365: boolean }>('/auth/sso/status').then((r) => r.data),
  refresh: () => client.post<TokenResponse>('/auth/refresh'),
  logout: () => client.post<void>('/auth/logout'),
  me: () => client.get<UserResponse>('/auth/me'),
};
