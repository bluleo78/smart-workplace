// 프로젝트 관련 타입 — 백엔드 ProjectResponse 와 1:1 매칭. 변경 시 동기화 필수.

import type { UserKind } from './user';

// 프로젝트 유형 — TEAM(팀 공유) | PERSONAL(개인 전용). 백엔드 ProjectType 과 매칭.
export type ProjectType = 'TEAM' | 'PERSONAL';

export interface ProjectResponse {
  id: number;
  key: string;
  name: string;
  description: string | null;
  ownerId: number;
  type: ProjectType;
  // 사용자별 기본 개인 프로젝트 여부 (서버가 자동 생성한 개인 프로젝트).
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  // 목록 화면 집계 — 상세/생성 응답에선 0/빈배열일 수 있음
  issueTotal: number;
  issueDone: number;
  memberCount: number;
  memberNames: string[];
}

export type ProjectMemberRole = 'OWNER' | 'MEMBER';

export interface MemberResponse {
  userId: number;
  username: string;
  name: string;
  // HUMAN (사람) | AGENT (AI). assignee 픽커 등에서 시각 구분에 사용.
  kind: UserKind;
  role: ProjectMemberRole;
  // AGENT 후보(개인 프로젝트 assignee 후보)의 합성 row 는 서버가 null 을 내려준다.
  createdAt: string | null;
}

export interface CreateProjectRequest {
  // PERSONAL 은 생략(서버가 키 자동 생성). TEAM 은 필수.
  key?: string;
  name: string;
  description?: string;
  // 미지정 시 서버 기본값 TEAM.
  type?: ProjectType;
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
