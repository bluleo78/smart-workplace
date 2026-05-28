// 프로젝트 관련 타입 — 백엔드 ProjectResponse 와 1:1 매칭. 변경 시 동기화 필수.

import type { UserKind } from './user';

export interface ProjectResponse {
  id: number;
  key: string;
  name: string;
  description: string | null;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectMemberRole = 'OWNER' | 'MEMBER';

export interface MemberResponse {
  userId: number;
  username: string;
  name: string;
  // HUMAN (사람) | AGENT (AI). assignee 픽커 등에서 시각 구분에 사용.
  kind: UserKind;
  role: ProjectMemberRole;
  createdAt: string;
}

export interface CreateProjectRequest {
  key: string;
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name: string;
  description?: string;
}

export interface AddMemberRequest {
  userId: number;
  role: ProjectMemberRole;
}

export interface UpdateMemberRoleRequest {
  role: ProjectMemberRole;
}
