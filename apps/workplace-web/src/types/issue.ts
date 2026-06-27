// 이슈/댓글/이력 관련 타입 — 백엔드 DTO 와 1:1 매칭.

import type { IssueAttachment } from './attachment';
import type { IssueFieldEntry } from './customField';
import type { IssueTypeSummary } from './issueType';
import type { LabelSummary } from './label';
import type { UserSummary } from './user';

export type IssueStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type IssuePriority = 'LOW' | 'MID' | 'HIGH';

// 자식 이슈가 응답에 포함하는 부모 요약 (Phase 4a).
export interface ParentRef {
  number: number;
  title: string;
  type: IssueTypeSummary;
}

// 의존성 응답에 임베드되는 이슈 요약 (Phase 4b).
// blockedBy/blocks 양쪽에서 동일 모양으로 사용된다.
export interface IssueLinkSummary {
  number: number;
  title: string;
  status: string;
  type: IssueTypeSummary;
}

export interface IssueResponse {
  id: number;
  projectKey: string;
  number: number;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  dueDate: string | null;
  reporterId: number;
  createdAt: string;
  updatedAt: string;
  // 부착된 라벨 — 백엔드가 항상 배열로 내려준다 (없으면 빈 배열).
  labels: LabelSummary[];
  // 이슈에 부착된 첨부 개수 — N+1 회피용 카운트 (목록 카드 표시).
  attachmentCount: number;
  // 이슈 유형 요약 — 검색·상세 응답에는 항상 채워지지만,
  // POST /issues 응답(생성 직후) 은 null 일 수 있다. list 재조회 시 채워진다.
  type: IssueTypeSummary | null;
  // 다중 담당자 — Phase 3c. 항상 배열 (없으면 빈 배열).
  assignees: UserSummary[];
  // SUBTASK 일 때만 채워지는 부모 요약 (Phase 4a).
  parent: ParentRef | null;
  // 이 이슈를 부모로 가진 자식 SUBTASK 수 (비SUBTASK 만 0 초과 가능).
  childCount: number;
  // 자식 중 DONE 인 SUBTASK 수 — 진행률 표시용.
  childDoneCount: number;
  // 이 이슈를 차단(blocking) 하는 의존성 — 선행 완료 필요 (Phase 4b).
  blockedBy: IssueLinkSummary[];
  // 이 이슈가 차단(blocking) 중인 이슈들 (Phase 4b).
  blocks: IssueLinkSummary[];
  // blockedBy 중 미완료 이슈 존재 여부 — 헤더 ⛔ 배지/카드 마커 분기 (Phase 4b).
  blocked: boolean;
  // 프로젝트 커스텀 필드의 현재 값 목록 (Phase 4c). 정의는 있는데 값이 없는 필드는 빠진다.
  customFields: IssueFieldEntry[];
}

export interface IssueCommentResponse {
  id: number;
  issueId: number;
  authorId: number;
  authorName: string;
  // HUMAN (사람) | AGENT (AI). 백엔드 user.kind 와 1:1 (V14). AGENT 코멘트는 UI 에서 시각 구분.
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type IssueHistoryEventType =
  | 'TITLE_CHANGED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'ASSIGNEES_CHANGED'
  | 'DUE_DATE_CHANGED'
  | 'LABELS_CHANGED'
  | 'ATTACHMENTS_CHANGED'
  | 'TYPE_CHANGED'
  // 부모 변경/해제 (Phase 4a).
  | 'PARENT_CHANGED'
  // 의존성 추가/제거 (Phase 4b).
  | 'DEPENDENCY_ADDED'
  | 'DEPENDENCY_REMOVED'
  // 커스텀 필드 값 변경 (Phase 4c).
  | 'CUSTOM_FIELD_CHANGED';

export interface IssueHistoryEntry {
  id: number;
  actorId: number;
  actorName: string;
  // HUMAN | AGENT. 타임라인에서 AGENT 행은 시각 구분.
  actorKind: 'HUMAN' | 'AGENT';
  eventType: IssueHistoryEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

// AI가 탐지한 블로커 배지 — type 별 심각도가 다르다(BLOCKED>OVERDUE>STALE).
export interface IssueBlockerBadge {
  type: 'BLOCKED' | 'OVERDUE' | 'STALE';
  message: string;
}

// 이슈 AI 즉각 컨텍스트 — 백엔드 #517 Task 5/6 완료 후 채워짐. 카드 컴포넌트는 null/undefined 면 미렌더.
export interface IssueAiContext {
  summary: string | null;
  nextAction: string | null;
  generatedAt: string | null;
  blockers: IssueBlockerBadge[];
}

export interface IssueDetailResponse {
  summary: IssueResponse;
  body: string | null;
  comments: IssueCommentResponse[];
  history: IssueHistoryEntry[];
  // 이슈에 부착된 첨부 목록 — 상세 진입 시 함께 응답.
  attachments: IssueAttachment[];
  // AI 즉각 컨텍스트 (#517) — 백엔드 미완료 시 undefined. 카드는 graceful하게 미렌더.
  aiContext?: IssueAiContext | null;
}

export interface CreateIssueRequest {
  title: string;
  body?: string;
  priority?: IssuePriority;
  dueDate?: string;
  // 다중 담당자 — Phase 3c. 생략/빈배열/null 모두 "지정 안함" 의미.
  assigneeIds?: number[] | null;
  // 이슈 유형 id — 생략 시 백엔드가 TASK 로 fallback.
  typeId?: number | null;
  // SUBTASK 일 때만 부모 number 동봉 (Phase 4a). 비SUBTASK 에 동봉하면 400.
  parentNumber?: number | null;
}

export interface UpdateIssueRequest {
  title?: string;
  body?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  dueDate?: string;
  // dueDate 단독 비우기 플래그 — true 면 dueDate 무시.
  clearDueDate?: boolean;
}

export interface CreateCommentRequest { body: string }
export interface UpdateCommentRequest { body: string }

// 이슈 검색 응답 — cursor 기반 페이지네이션.
export interface IssueSearchResponse {
  items: IssueResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

// 필터 상태 — URL 의 SearchParams 와 1:1 매핑되는 정규화된 형태.
export interface IssueFilters {
  q: string;
  statuses: string[];
  priorities: string[];
  assigneeIds: number[];
  includeUnassigned: boolean;
  dueFrom: string | null;
  dueTo: string | null;
  // 다중 라벨 AND 필터 — 모든 라벨이 부착된 이슈만 매칭.
  labelIds: number[];
  // 다중 사이클 OR 필터 — 선택된 사이클 중 하나에 속한 이슈 매칭.
  cycleIds: number[];
  // 다중 유형 OR 필터 — 선택된 유형 중 하나에 속한 이슈 매칭.
  typeIds: number[];
  // 특정 부모(번호) 의 자식만 보기 (Phase 4a) — UI 노출은 deferred, URL 직렬화만.
  parentNumber: number | null;
  // 최상위(부모 없는) 이슈만 보기 (Phase 4a) — UI 노출 deferred.
  topLevel: boolean;
  // 차단된(blocked) 이슈만 보기 (Phase 4b) — UI 노출 deferred, URL 직렬화만.
  blocked: boolean;
}

// 프로젝트 상세에서 이슈 목록을 표시하는 두 가지 뷰.
export type IssueView = 'list' | 'board';

// 보드/리스트 그룹 기준 (#58). null/부재 = 그룹 없음(평탄 리스트 / 상태 보드).
// view 와 동일하게 IssueFilters 와 분리된 URL 쿼리스트링 키('group')로 다룬다.
export type IssueGroupBy = 'status' | 'assignee' | 'priority';
