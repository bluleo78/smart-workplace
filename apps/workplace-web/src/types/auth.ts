export interface SignupRequest {
  username: string;
  password: string;
  name: string;
  email?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

/** 사용자의 테넌트 멤버십 — 백엔드 MembershipResponse 와 1:1. */
export interface Membership {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
}

/**
 * 1단계 로그인 응답: tenant-less(또는 단일 자동선택 시 tenant-scoped) access 토큰
 * + 선택 가능한 활성 멤버십 목록(refresh 는 쿠키).
 */
export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  memberships: Membership[];
}

// 사용자 종류 — Phase 5a 부터 백엔드 UserResponse 마지막 필드로 추가됨.
import type { UserKind } from './user';

export interface UserResponse {
  id: number;
  username: string;
  email: string | null;
  name: string;
  isActive: boolean;
  createdAt: string;
  kind: UserKind;
  // AI 가용성 — 개인/공통 비서 보유 여부.
  aiAvailable: boolean;
}

export interface ErrorResponse {
  status: number;
  error: string;
  message: string;
  errors?: Record<string, string>;
}
