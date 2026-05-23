import type {
  IssueCommentResponse,
  IssueDetailResponse,
  IssueHistoryEntry,
  IssueResponse,
  IssueSearchResponse,
} from '../../src/types/issue';

// 테스트용 이슈 요약 객체 팩토리.
export function createIssue(overrides: Partial<IssueResponse> = {}): IssueResponse {
  const now = new Date().toISOString();
  return {
    id: 100,
    projectKey: 'WP',
    number: 1,
    title: '첫 이슈',
    status: 'TODO',
    priority: 'MID',
    dueDate: null,
    reporterId: 1,
    createdAt: now,
    updatedAt: now,
    labels: [],
    attachmentCount: 0,
    assignees: [],
    ...overrides,
  };
}

// 테스트용 코멘트 객체 팩토리.
export function createComment(overrides: Partial<IssueCommentResponse> = {}): IssueCommentResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    issueId: 100,
    authorId: 1,
    authorName: 'Tester',
    body: '확인했습니다',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// 테스트용 이슈 이력 항목 팩토리.
export function createHistoryEntry(overrides: Partial<IssueHistoryEntry> = {}): IssueHistoryEntry {
  return {
    id: 1,
    actorId: 1,
    actorName: 'Tester',
    eventType: 'STATUS_CHANGED',
    fromValue: 'TODO',
    toValue: 'IN_PROGRESS',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// 이슈 검색 응답(cursor 페이징) 팩토리. nextCursor 가 null 이 아니면 hasMore=true.
export function createIssueSearchResponse(
  items: IssueResponse[] = [],
  nextCursor: string | null = null,
): IssueSearchResponse {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

// 테스트용 이슈 상세 응답 팩토리.
export function createIssueDetail(overrides: Partial<IssueDetailResponse> = {}): IssueDetailResponse {
  return {
    summary: createIssue(),
    body: '본문',
    comments: [],
    history: [],
    attachments: [],
    ...overrides,
  };
}
