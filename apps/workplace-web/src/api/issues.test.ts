// WP-873 issueFilterParams — 완료일 기간 토큰이 서버 closedFrom/closedTo(KST 날짜) 로 풀려 실린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFilters } from '@/lib/issueFilters';

import { client } from './client';
import { getIssueGroupCounts, issueFilterParams, searchIssues } from './issues';

const EMPTY = parseFilters(new URLSearchParams());

describe('issueFilterParams — closedIn', () => {
  beforeEach(() => {
    // 2026-10-23(금) 정오 KST 로 시계 고정 — 프리셋은 호출 시점 기준으로 풀린다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00+09:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('프리셋은 호출 시점의 날짜 범위로 풀어 보낸다', () => {
    const p = issueFilterParams({ ...EMPTY, closedIn: 'last-week' });
    expect(p.get('closedFrom')).toBe('2026-10-12');
    expect(p.get('closedTo')).toBe('2026-10-18');
    expect(p.has('closedIn')).toBe(false);
  });

  it('직접 지정은 그대로 보낸다', () => {
    const p = issueFilterParams({ ...EMPTY, closedIn: '2026-09-01~2026-09-05' });
    expect(p.get('closedFrom')).toBe('2026-09-01');
    expect(p.get('closedTo')).toBe('2026-09-05');
  });

  it('closedIn 이 없으면 보내지 않는다', () => {
    const p = issueFilterParams(EMPTY);
    expect(p.has('closedFrom')).toBe(false);
    expect(p.has('closedTo')).toBe(false);
  });
});

// WP-933: 구성요소 필터는 서버에 component=id,…,none 으로 실린다(URL 과 같은 표현).
describe('issueFilterParams — component', () => {
  it('id 와 「구성요소 없음」을 component 한 키로 보낸다', () => {
    expect(issueFilterParams({ ...EMPTY, componentIds: [3, 5], componentNone: true }).get('component')).toBe('3,5,none');
    expect(issueFilterParams(EMPTY).has('component')).toBe(false);
  });
});

// WP-888: 수정 버전·영향 버전 필터는 각각 fixVersion·affectsVersion 으로 실린다(id,…,none).
describe('issueFilterParams — 버전', () => {
  it('두 필터를 각자의 키로 보낸다', () => {
    const p = issueFilterParams({ ...EMPTY, fixVersionIds: [3], fixVersionNone: true, affectsVersionIds: [8] });
    expect(p.get('fixVersion')).toBe('3,none');
    expect(p.get('affectsVersion')).toBe('8');
    expect(issueFilterParams(EMPTY).has('fixVersion')).toBe(false);
    expect(issueFilterParams(EMPTY).has('affectsVersion')).toBe(false);
  });
});

// WP-1238: 정렬은 목록 검색(searchIssues)에만 실린다 — checklist 정렬(order)과는 함께 보내지 않고, 그룹 총계에도 보내지 않는다.
describe('searchIssues — 정렬', () => {
  afterEach(() => vi.restoreAllMocks());
  const sentQuery = () => {
    const spy = vi.spyOn(client, 'get').mockResolvedValue({ data: { items: [], nextCursor: null, hasMore: false, groups: [] } });
    return () => new URL(`http://x${spy.mock.calls.at(-1)![0] as string}`).searchParams;
  };

  it('고른 정렬을 sort·direction 으로 보내고, 다음 페이지(cursor)에도 같이 싣는다', async () => {
    const q = sentQuery();
    await searchIssues('WP', { ...EMPTY, sort: 'dueDate', direction: 'asc' }, 'c-1');
    expect(q().get('sort')).toBe('dueDate');
    expect(q().get('direction')).toBe('asc');
    expect(q().get('cursor')).toBe('c-1');
  });

  it('정렬이 없으면 보내지 않는다 — 서버 기본(수정일 내림차순) 그대로', async () => {
    const q = sentQuery();
    await searchIssues('WP', EMPTY, null);
    expect(q().has('sort')).toBe(false);
    expect(q().has('direction')).toBe(false);
  });

  it('checklist 정렬(order)과 함께면 sort·direction 을 싣지 않는다(서버 계약상 배타)', async () => {
    const q = sentQuery();
    await searchIssues('WP', { ...EMPTY, sort: 'priority', direction: 'desc' }, null, 100, { order: 'checklist', mode: 'status' });
    expect(q().get('order')).toBe('checklist');
    expect(q().has('sort')).toBe(false);
    expect(q().has('direction')).toBe(false);
  });

  it('그룹 총계엔 정렬을 보내지 않는다', async () => {
    const q = sentQuery();
    await getIssueGroupCounts('WP', { ...EMPTY, sort: 'status', direction: 'asc' }, 'priority');
    expect(q().has('sort')).toBe(false);
  });
});
