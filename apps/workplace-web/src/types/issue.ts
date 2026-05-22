// 이슈/댓글/이력 관련 타입 — 백엔드 DTO 와 1:1 매칭.

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
  assigneeId: number | null;
  createdAt: string;
  updatedAt: string;
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
  | 'DUE_DATE_CHANGED';

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
}

export interface CreateIssueRequest {
  title: string;
  body?: string;
  priority?: IssuePriority;
  dueDate?: string;
  assigneeId?: number | null;
}

export interface UpdateIssueRequest {
  title?: string;
  body?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  dueDate?: string;
  assigneeId?: number;
  clearAssignee?: boolean;
  clearDueDate?: boolean;
}

export interface CreateCommentRequest { body: string }
export interface UpdateCommentRequest { body: string }
