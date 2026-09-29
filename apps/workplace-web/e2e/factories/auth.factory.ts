/**
 * 인증 도메인 모킹 데이터 팩토리
 * src/types/auth.ts, role.ts, user.ts 타입 기반으로 테스트용 객체를 생성한다.
 * overrides 파라미터로 특정 필드만 덮어쓸 수 있다.
 */

import type { LoginResponse, Membership, TokenResponse, UserResponse } from '@/types/auth';
import type { MemberSummary } from '@/types/member';
import type { RoleResponse } from '@/types/role';
import type { UserDetailResponse } from '@/types/user';

/** 테넌트 멤버십(워크스페이스) 객체 생성 — 워크스페이스 스위처 테스트용. */
export function createMembership(overrides?: Partial<Membership>): Membership {
  return {
    tenantId: 1,
    tenantName: '에이콘 워크스페이스',
    tenantSlug: 'acorn',
    ...overrides,
  };
}

/** 1단계 로그인 응답 생성 — memberships 기본 1개(단일소속/통과 경로) */
export function createLoginResponse(overrides?: Partial<LoginResponse>): LoginResponse {
  return {
    accessToken: 'mock-access-token-12345',
    tokenType: 'Bearer',
    expiresIn: 3600,
    memberships: [createMembership()],
    ...overrides,
  };
}

/** 기본 사용자 응답 객체 생성 — kind default 'HUMAN'. */
export function createUser(overrides?: Partial<UserResponse>): UserResponse {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    name: '테스트 사용자',
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    kind: 'HUMAN',
    aiAvailable: false,
    hasPassword: true,
    ...overrides,
  };
}

/** JWT 토큰 응답 객체 생성 */
export function createTokenResponse(overrides?: Partial<TokenResponse>): TokenResponse {
  return {
    accessToken: 'mock-access-token-12345',
    tokenType: 'Bearer',
    expiresIn: 3600,
    ...overrides,
  };
}

/** 역할(Role) 응답 객체 생성 */
export function createRole(overrides?: Partial<RoleResponse>): RoleResponse {
  return {
    id: 1,
    name: 'USER',
    description: '일반 사용자',
    isSystem: true,
    ...overrides,
  };
}

/** 역할 목록을 포함한 사용자 상세 응답 객체 생성 */
export function createUserDetail(overrides?: Partial<UserDetailResponse>): UserDetailResponse {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    name: '테스트 사용자',
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    roles: [createRole()],
    kind: 'HUMAN',
    aiAvailable: false,
    hasPassword: true,
    ...overrides,
  };
}

/** ADMIN 역할이 포함된 관리자 사용자 상세 응답 객체 생성 */
export function createAdminUserDetail(overrides?: Partial<UserDetailResponse>): UserDetailResponse {
  return createUserDetail({
    id: 2,
    username: 'adminuser',
    email: 'admin@example.com',
    name: '관리자',
    roles: [
      createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자' }),
    ],
    ...overrides,
  });
}

/**
 * 구성원 디렉터리 항목(MemberSummary) 생성 — 계정(UserResponse)과 다른 타입이다 (#833).
 *
 * 계정(/api/v1/users, ADMIN 전용)은 "누가 로그인할 수 있는가"를, 구성원(/api/v1/members)은
 * "우리 워크스페이스에 누가 있는가"를 답한다. 그래서 필드가 다르다 — id→userId, isActive→active,
 * title/membershipRole/membershipStatus 가 추가되고 createdAt/aiAvailable 은 없다.
 * 목록·검색 스텁은 이 팩토리를 쓰고, /users/me 같은 계정 API 스텁만 createUser 를 쓴다.
 */
export function createMember(overrides?: Partial<MemberSummary>): MemberSummary {
  return {
    userId: 1,
    username: 'testuser',
    name: '테스트 사용자',
    email: 'test@example.com',
    title: null,
    kind: 'HUMAN',
    active: true,
    membershipRole: 'MEMBER',
    membershipStatus: 'ACTIVE',
    ...overrides,
  };
}
