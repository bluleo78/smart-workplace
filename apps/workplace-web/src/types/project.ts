// 프로젝트 관련 타입 — 백엔드 ProjectResponse 와 1:1 매칭. 변경 시 동기화 필수.

import type { UserKind } from './user';

// 프로젝트 유형 — TEAM(팀 공유) | PERSONAL(개인 전용) | OPEN(공개 접수함). 백엔드 ProjectType 과 매칭.
export type ProjectType = 'TEAM' | 'PERSONAL' | 'OPEN';

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
  // 현재 로그인 사용자가 이 프로젝트의 멤버(MEMBER/OWNER) 또는 ADMIN 인지 — 서버 계산 플래그.
  // 보드 drag-to-change-status, 이슈 생성 버튼 노출 게이트에 사용. 재파생 금지.
  viewerIsMember: boolean;
  // 실제 멤버 역할(OWNER/MEMBER, 아니면 null) — viewerIsMember 와 달리 ADMIN 우회가 없다(WP-1011, 외부 AI 가 맡을 프로젝트 고르기).
  viewerRole?: 'OWNER' | 'MEMBER' | null;
  // 연결된 저장소(WP-1011) — AI 가 이 프로젝트의 이슈를 처리할 때 쓰는 코드 저장소 주소·기본 브랜치. 없으면 null.
  repositoryUrl?: string | null;
  repositoryBranch?: string | null;
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
  // 이 워크스페이스에서 활성인가(전역 비활성·WP-417 정지면 false) — 담당자 후보에서 뺀다(WP-487). 예전 응답·목에는 없을 수 있다.
  active?: boolean;
}

export interface CreateProjectRequest {
  // PERSONAL 은 생략(서버가 키 자동 생성). TEAM 은 필수.
  key?: string;
  name: string;
  description?: string;
  // 미지정 시 서버 기본값 TEAM.
  type?: ProjectType;
}

/** 부분 수정 — 보낸 칸만 바뀐다. 저장소 칸은 빈 문자열이면 지운다(WP-1011). */
export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  repositoryUrl?: string;
  repositoryBranch?: string;
}

export interface AddMemberRequest {
  userId: number;
  role: ProjectMemberRole;
}

export interface UpdateMemberRoleRequest {
  role: ProjectMemberRole;
}
