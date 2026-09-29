import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import resourceContract from './resource-contract.json';
import {
  createInvalidationBatcher,
  type InvalidationTarget,
  invalidationTargets,
  isProtectedKey,
  type ResourceChangedPayload,
  ruleResourceNames,
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

describe('프로젝트 설정 규칙 (WP-60)', () => {
  const keysOf = (resource: string, op: ResourceChangedPayload['op'], projectKey = 'EX') =>
    invalidationTargets({ resource, op, projectKey }).map((t) => t.queryKey);

  it('label deleted → labels + 이슈 대상', () => {
    const keys = keysOf('label', 'deleted');
    expect(keys).toEqual(expect.arrayContaining([['labels', 'EX'], ['issues', 'search', 'EX']]));
  });

  it('label created → labels 만 (이슈 대상 없음)', () => {
    const keys = keysOf('label', 'created');
    expect(keys).toContainEqual(['labels', 'EX']);
    expect(keys).not.toContainEqual(['issues', 'search', 'EX']);
  });

  it('project-member deleted → projects + 이슈 대상', () => {
    expect(keysOf('project-member', 'deleted')).toEqual(
      expect.arrayContaining([['projects'], ['issues', 'search', 'EX']]),
    );
  });

  it('project-member created/updated → projects 만 (담당자 해제가 없어 이슈 대상 불필요)', () => {
    expect(keysOf('project-member', 'created')).toEqual([['projects']]);
    expect(keysOf('project-member', 'updated')).toEqual([['projects']]);
  });

  it('설정 수정·삭제의 이슈 대상은 목록·상세·내 이슈·워치만 (의존성·첨부·홈 위젯 제외)', () => {
    expect(keysOf('label', 'updated')).toEqual([
      ['labels', 'EX'],
      ['issues', 'search', 'EX'],
      ['issues', 'EX'],
      ['me-issues'],
      ['watched-issues'],
    ]);
    expect(keysOf('milestone', 'deleted')).not.toContainEqual(['home', 'activity']);
  });

  it('cycle 수정·삭제 → cycles·cycleProgress·issueCycles + 이슈 값 대상', () => {
    expect(keysOf('cycle', 'deleted')).toEqual([
      ['cycles', 'EX'],
      ['cycleProgress', 'EX'],
      ['issueCycles', 'EX'],
      ['issues', 'search', 'EX'],
      ['issues', 'EX'],
      ['me-issues'],
      ['watched-issues'],
    ]);
    expect(keysOf('cycle', 'created')).toEqual([['cycles', 'EX'], ['cycleProgress', 'EX'], ['issueCycles', 'EX']]);
  });

  it('saved-view → savedViews + pinnedViews', () => {
    expect(keysOf('saved-view', 'created')).toEqual(expect.arrayContaining([['savedViews', 'EX'], ['pinnedViews']]));
  });

  it('project deleted → projects, pinnedViews, me-issues', () => {
    expect(keysOf('project', 'deleted')).toEqual(
      expect.arrayContaining([['projects'], ['pinnedViews'], ['me-issues']]),
    );
    expect(keysOf('project', 'updated')).not.toContainEqual(['me-issues']);
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

describe('캘린더 규칙', () => {
  it.each(['calendar-event', 'calendar'])('%s 는 [calendar] 루트 전체를 무효화한다', (resource) => {
    for (const op of ['created', 'updated', 'deleted'] as const) {
      expect(invalidationTargets({ resource, op, scopeType: 'USER', scopeId: 1, ids: [1] })).toEqual([
        { queryKey: ['calendar'] },
      ]);
    }
  });
});

// 키 팩토리(driveKeys·messagingKeys·wikiKeys …)로 바꿔도 실제 키 값이 그대로인지 리터럴로 고정한다 — 팩토리로 기대값을 만들면 같은 실수를 검증하지 못한다.
describe('규칙 키 값 고정', () => {
  const keys = (p: ResourceChangedPayload) => invalidationTargets(p);

  it('channel → 채널 목록·탐색·상세·멤버·요약·드라이브 공간 목록', () => {
    expect(keys({ resource: 'channel', op: 'updated', channelId: 3 })).toEqual([
      { queryKey: ['messaging', 'channels'] },
      { queryKey: ['messaging', 'discover'] },
      { queryKey: ['messaging', 'detail', 3] },
      { queryKey: ['messaging', 'members', 3] },
      { queryKey: ['messaging-summary'] },
      { queryKey: ['drive', 'spaces'] },
    ]);
  });

  it('dm → DM 목록·요약', () => {
    expect(keys({ resource: 'dm', op: 'created', channelId: 4 })).toEqual([
      { queryKey: ['messaging', 'dms'] },
      { queryKey: ['messaging-summary'] },
    ]);
  });

  it('drive → 공간 prefix(items·trash·search) + quota·첨부·백링크', () => {
    expect(keys({ resource: 'drive', op: 'updated', spaceId: 2 })).toEqual([
      { queryKey: ['drive', 'items', 2] },
      { queryKey: ['drive', 'trash', 2] },
      { queryKey: ['drive', 'search', 2] },
      { queryKey: ['drive', 'quota'] },
      { queryKey: ['drive-attachments'] },
      { queryKey: ['drive-file-backlinks'] },
    ]);
  });

  it('drive-space → 공간 목록·단건·items prefix', () => {
    expect(keys({ resource: 'drive-space', op: 'updated', spaceId: 2 })).toEqual([
      { queryKey: ['drive', 'spaces'] },
      { queryKey: ['drive', 'space', 2] },
      { queryKey: ['drive', 'items', 2] },
    ]);
  });

  it('contact·notification → 루트 전체', () => {
    expect(keys({ resource: 'contact', op: 'updated' })).toEqual([{ queryKey: ['contacts'] }]);
    expect(keys({ resource: 'notification', op: 'updated' })).toEqual([{ queryKey: ['notifications'] }]);
  });

  it('mail → 계정 목록 prefix·회신필요 수·상세·연결 이슈·요약 위젯(exact)', () => {
    expect(keys({ resource: 'mail', op: 'updated', accountId: 5, messageId: 9 })).toEqual([
      { queryKey: ['mail-messages', 5] },
      { queryKey: ['mail-needs-reply-count', 5] },
      { queryKey: ['mail-message', 9] },
      { queryKey: ['mail', 'linked-issue', 9] },
      { queryKey: ['mail-summary'], exact: true },
    ]);
  });

  it('wiki-space·wiki-attachment → 스페이스 목록·멤버·트리 / 페이지', () => {
    expect(keys({ resource: 'wiki-space', op: 'updated', spaceId: 2 })).toEqual([
      { queryKey: ['wiki', 'spaces'] },
      { queryKey: ['wiki', 'members', 2] },
      { queryKey: ['wiki', 'tree', 2] },
    ]);
    expect(keys({ resource: 'wiki-attachment', op: 'created', spaceId: 2, pageId: 8 })).toEqual([
      { queryKey: ['wiki', 'page', 8] },
    ]);
  });

  it('chat-thread → 스레드 응답만', () => {
    expect(keys({ resource: 'chat-thread', op: 'updated', projectKey: 'EX', issueNumber: 1 })).toEqual([
      { queryKey: ['chat', 'thread', 'EX', 1] },
    ]);
  });
});

describe('mail-account 규칙 범위', () => {
  const keysOf = (op: ResourceChangedPayload['op'], accountId: number) =>
    invalidationTargets({ resource: 'mail-account', op, accountId }).map((t) => t.queryKey);

  it('개별 계정 수정 → 그 계정 메일 목록만, 캘린더는 유지(M365 연결이 updated 로 온다)', () => {
    const keys = keysOf('updated', 5);
    expect(keys).toContainEqual(['mail-messages', 5]);
    expect(keys).not.toContainEqual(['mail-messages']);
    expect(keys).toContainEqual(['calendar']);
  });

  it('일괄 설정(accountId 0)·생성·삭제 → 전체 메일 목록 prefix', () => {
    expect(keysOf('updated', 0)).toContainEqual(['mail-messages']);
    expect(keysOf('created', 5)).toContainEqual(['mail-messages']);
    expect(keysOf('deleted', 5)).toContainEqual(['mail-messages']);
    expect(keysOf('deleted', 5)).toContainEqual(['calendar']);
  });
});

describe('리소스 이름 계약', () => {
  it('RULES 키 목록 = resource-contract.json (백엔드 ResourceChangedContractTest 가 같은 파일을 RESOURCE_* 상수와 비교)', () => {
    expect([...ruleResourceNames()].sort()).toEqual([...resourceContract].sort());
  });
});

// 규칙이 캐시 패치·AI 요약·세션 키를 건드리지 않는지 — 리소스를 추가하는 task 는 SAMPLES 에 샘플 payload 를 넣는다.
const SAMPLES: ResourceChangedPayload[] = [
  { resource: 'issue', op: 'updated', projectKey: 'EX', issueNumber: 1 },
  // 캘린더 — calendar-event(ids)·calendar 는 projectKey 없이 scope USER 로 온다.
  { resource: 'calendar-event', op: 'updated', scopeType: 'USER', scopeId: 1, ids: [7] },
  { resource: 'calendar', op: 'updated', scopeType: 'USER', scopeId: 1, ids: [3] },
  // 채널·DM — attrs 는 channelId 만.
  { resource: 'channel', op: 'updated', scopeType: 'CHANNEL', scopeId: 3, channelId: 3 },
  { resource: 'dm', op: 'created', scopeType: 'CHANNEL', scopeId: 4, channelId: 4 },
  // 드라이브 — attrs 는 spaceId 만(ids 는 비어 있을 수 있음).
  { resource: 'drive', op: 'updated', scopeType: 'USER', scopeId: 1, spaceId: 2 },
  { resource: 'drive-space', op: 'updated', scopeType: 'USER', scopeId: 1, spaceId: 2 },
  { resource: 'contact', op: 'updated', scopeType: 'USER', scopeId: 1 },
  { resource: 'notification', op: 'updated', scopeType: 'USER', scopeId: 1 },
  { resource: 'chat-thread', op: 'updated', projectKey: 'EX', issueNumber: 1 },
  { resource: 'mail', op: 'updated', accountId: 5, messageId: 9 },
  { resource: 'mail-account', op: 'updated', accountId: 5 },
  { resource: 'wiki-space', op: 'updated', spaceId: 2 },
  { resource: 'wiki-attachment', op: 'updated', spaceId: 2, pageId: 8 },
  ...['project', 'project-member', 'label', 'milestone', 'cycle', 'field-def', 'issue-type', 'saved-view'].map(
    (resource) => ({ resource, op: 'updated' as const, projectKey: 'EX' }),
  ),
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
