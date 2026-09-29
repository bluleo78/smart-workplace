import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInvalidationBatcher, invalidationTargets, isProtectedKey } from './resourceInvalidation';

describe('invalidationTargets', () => {
  it('issue → 해당 프로젝트 검색·상세·하위 리소스 + 내 이슈 계열', () => {
    const keys = invalidationTargets({
      resource: 'issue', op: 'updated', scopeType: 'PROJECT', scopeId: 7, ids: [39], actorId: 1,
      projectKey: 'EX', issueNumber: 21,
    }).map((t) => t.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['issues', 'search', 'EX'],
        ['issues', 'EX'],
        ['me-issues'],
        ['watched-issues'],
        ['my-issue-dues'],
        ['home', 'myIssues'],
        ['home', 'watched'],
        ['home', 'activity'],
        ['issue-dependencies', 'EX'],
        ['attachments', 'EX'],
        ['watchers', 'EX'],
        ['issue-drive-links', 'EX'],
        ['issueCycles', 'EX'],
        ['cycleProgress', 'EX'],
      ]),
    );
  });

  it('projectKey 없는 issue 이벤트 · 모르는 resource → 빈 목록', () => {
    expect(invalidationTargets({ resource: 'issue', op: 'updated' } as never)).toEqual([]);
    expect(invalidationTargets({ resource: 'nope', op: 'updated' } as never)).toEqual([]);
  });
});

describe('isProtectedKey', () => {
  it('AI 요약·세션 계열은 보호, 일반 키는 아님', () => {
    expect(isProtectedKey(['mail-summary', 5])).toBe(true);
    expect(isProtectedKey(['mail-summary'])).toBe(false); // 위젯 키는 exact 로 무효화 가능
    expect(isProtectedKey(['messaging', 'catchup', 1, 'x'])).toBe(true);
    expect(isProtectedKey(['drive-file-summary', 3])).toBe(true);
    expect(isProtectedKey(['drive-thumbnail', 3])).toBe(true);
    expect(isProtectedKey(['priority-items'])).toBe(true);
    expect(isProtectedKey(['chat', 'messages', 1])).toBe(true);
    expect(isProtectedKey(['home', 'sessions'])).toBe(true);
    expect(isProtectedKey(['issues', 'search', 'EX'])).toBe(false);
  });
});

describe('createInvalidationBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('짧은 시간 안의 중복 대상은 한 번만 invalidate (MCP update_issue 가 5개 엔드포인트를 연달아 호출)', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const b = createInvalidationBatcher(qc, 100);
    for (let i = 0; i < 5; i++) b.enqueue([{ queryKey: ['issues', 'search', 'EX'] }]);
    b.enqueue([{ queryKey: ['me-issues'] }]);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['issues', 'search', 'EX'], exact: false });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me-issues'], exact: false });
  });
});
