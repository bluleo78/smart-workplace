import type { RoleResponse } from './role';

// 사용자 종류 — HUMAN(일반 사용자) | AGENT(AI 워커, 비밀번호 없음 / API 키 로그인).
export type UserKind = 'HUMAN' | 'AGENT';

export interface UserDetailResponse {
  id: number;
  username: string;
  email: string | null;
  name: string;
  isActive: boolean;
  createdAt: string;
  roles: RoleResponse[];
  kind: UserKind;
}


export interface UpdateProfileRequest {
  name: string;
  email?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface SetRolesRequest {
  roleIds: number[];
}

export interface SetActiveRequest {
  active: boolean;
}

// 이슈 응답 등에서 사용자 요약을 표현하는 공통 DTO — 백엔드 UserSummary 와 1:1.
export interface UserSummary {
  id: number;
  username: string;
  name: string;
  kind: UserKind;
}

// 구성원(계정) 추가 요청 — 백엔드 CreateMemberRequest 와 1:1. email 은 선택값.
export interface CreateMemberRequest {
  username: string;
  email?: string;
  name: string;
  password: string;
  role: 'ADMIN' | 'USER';
}

// 구성원 추가 응답 — 백엔드 MemberResponse 와 1:1.
export interface MemberResponse {
  userId: number;
  username: string;
  name: string;
  email: string | null;
  role: string;
  status: string;
}
