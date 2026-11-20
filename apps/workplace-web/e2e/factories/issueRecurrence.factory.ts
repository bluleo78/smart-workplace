// 이슈 실행 일정(「AI 에게 맡기기」, WP-989·WP-1314) GET 응답 목 팩토리 — 여러 spec 이 같은 12개 필드를 손으로 쓰던 것을 한곳에 모은다(WP-1809).
import type { IssueRecurrence } from '../../src/types/issueRecurrence';

/** 매일 09:00, 담당 AI 「트리스타나」, 고칠 수 있고 실행 중이 아닌 일정. 바꿀 필드만 넘긴다. */
export function createIssueRecurrence(overrides: Partial<IssueRecurrence> = {}): IssueRecurrence {
  return {
    rrule: 'FREQ=DAILY',
    time: '09:00',
    enabled: true,
    nextRunAt: '2030-01-02T00:00:00Z',
    consecutiveFailures: 0,
    lastRunAt: null,
    agentUserId: 900,
    agentName: '트리스타나',
    editable: true,
    testRunning: false,
    ...overrides,
  };
}
