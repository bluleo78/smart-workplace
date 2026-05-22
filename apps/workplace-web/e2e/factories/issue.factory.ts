import type {
  IssueCommentResponse,
  IssueDetailResponse,
  IssueHistoryEntry,
  IssueResponse,
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
    assigneeId: null,
    createdAt: now,
    updatedAt: now,
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

// 테스트용 이슈 상세 응답 팩토리.
export function createIssueDetail(overrides: Partial<IssueDetailResponse> = {}): IssueDetailResponse {
  return {
    summary: createIssue(),
    body: '본문',
    comments: [],
    history: [],
    ...overrides,
  };
}
