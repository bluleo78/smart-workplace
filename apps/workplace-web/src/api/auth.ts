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
  // 1단계 로그인 — tenant-less access + 선택 가능한 멤버십 목록 반환
  login: (data: LoginRequest) => client.post<LoginResponse>('/auth/login', data),
  // 2단계 — 테넌트 선택/전환(tenant-scoped 토큰 재발급)
  selectTenant: (tenantId: number) =>
    client.post<TokenResponse>('/auth/select-tenant', { tenantId }),
  // 내 활성 멤버십 목록(전환 팝오버에서 lazy fetch)
  memberships: () => client.get<Membership[]>('/auth/memberships'),
  refresh: () => client.post<TokenResponse>('/auth/refresh'),
  logout: () => client.post<void>('/auth/logout'),
  me: () => client.get<UserResponse>('/auth/me'),
};
