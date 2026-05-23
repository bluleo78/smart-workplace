// 이슈/댓글/이력 관련 타입 — 백엔드 DTO 와 1:1 매칭.

import type { IssueAttachment } from './attachment';
import type { LabelSummary } from './label';
import type { UserSummary } from './user';

export type IssueStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type IssuePriority = 'LOW' | 'MID' | 'HIGH';

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
  // 다중 담당자 — Phase 3c. 항상 배열 (없으면 빈 배열).
  assignees: UserSummary[];
}

export interface IssueCommentResponse {
  id: number;
  issueId: number;
  authorId: number;
  authorName: string;
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
  | 'ATTACHMENTS_CHANGED';

export interface IssueHistoryEntry {
  id: number;
  actorId: number;
  actorName: string;
  eventType: IssueHistoryEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface IssueDetailResponse {
  summary: IssueResponse;
  body: string | null;
  comments: IssueCommentResponse[];
  history: IssueHistoryEntry[];
  // 이슈에 부착된 첨부 목록 — 상세 진입 시 함께 응답.
  attachments: IssueAttachment[];
}

export interface CreateIssueRequest {
  title: string;
  body?: string;
  priority?: IssuePriority;
  dueDate?: string;
  // 다중 담당자 — Phase 3c. 생략/빈배열/null 모두 "지정 안함" 의미.
  assigneeIds?: number[] | null;
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
}

// 프로젝트 상세에서 이슈 목록을 표시하는 두 가지 뷰.
export type IssueView = 'list' | 'board';
