import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInvalidationBatcher,
  invalidationTargets,
  isProtectedKey,
  type InvalidationTarget,
  type ResourceChangedPayload,
} from './resourceInvalidation';

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

  it('Object.prototype 상속 키(toString/constructor) resource → 빈 목록', () => {
    expect(invalidationTargets({ resource: 'toString', op: 'updated', projectKey: 'EX' } as never)).toEqual([]);
    expect(invalidationTargets({ resource: 'constructor', op: 'updated', projectKey: 'EX' } as never)).toEqual([]);
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
    expect(isProtectedKey(['api-blob', '/api/v1/files/1'])).toBe(true);
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

  it('트레일링 디바운스 — t=0,80,160,240 간격 이벤트는 한 번만 flush', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const b = createInvalidationBatcher(qc, 100);
    for (let i = 0; i < 4; i++) {
      b.enqueue([{ queryKey: ['issues', 'search', 'EX'] }]);
      if (i < 3) vi.advanceTimersByTime(80);
    }
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('끊임없는 이벤트(80ms 간격)도 첫 이벤트 후 500ms 안에는 flush 된다', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const b = createInvalidationBatcher(qc, 100, 500);
    for (let at = 0; at < 480; at += 80) {
      b.enqueue([{ queryKey: ['issues', 'search', 'EX'] }]);
      vi.advanceTimersByTime(80);
    }
    expect(qc.invalidateQueries).not.toHaveBeenCalled(); // 480ms 시점
    b.enqueue([{ queryKey: ['issues', 'search', 'EX'] }]);
    vi.advanceTimersByTime(20); // 500ms
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

// 규칙이 캐시 패치·AI 요약·세션 키를 건드리지 않는지 — 리소스를 추가하는 task 는 SAMPLES 에 샘플 payload 를 넣는다.
const SAMPLES: ResourceChangedPayload[] = [
  { resource: 'issue', op: 'updated', projectKey: 'EX', issueNumber: 1 },
];

function forbiddenTarget(t: InvalidationTarget): boolean {
  const [a, b] = t.queryKey as unknown[];
  if (a === 'mail-summary') return !(t.queryKey.length === 1 && t.exact === true); // 위젯 키는 exact 만 허용
  if (a === 'messaging') return t.queryKey.length === 1 || ['messages', 'thread', 'threads', 'catchup'].includes(b as string);
  if (a === 'chat') return b !== 'thread';
  return isProtectedKey(t.queryKey);
}

describe('금지 키 가드', () => {
  it.each(SAMPLES.flatMap((s) => (['created', 'updated', 'deleted'] as const).map((op) => ({ ...s, op }))))(
    '$resource/$op 규칙은 금지 키를 무효화하지 않는다',
    (p) => {
      const targets = invalidationTargets(p);
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.filter(forbiddenTarget)).toEqual([]);
    },
  );
});
