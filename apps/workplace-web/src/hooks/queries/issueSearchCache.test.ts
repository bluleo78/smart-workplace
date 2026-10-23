// findIssueInSearchCache — 검색 캐시(여러 쿼리·페이지)에서 이슈 현재값을 찾는 리더 검증.
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { copyIssueIntoStatusColumn, findIssueInSearchCache } from './issueSearchCache';
import { BOARD_COLUMN_PAGE_SIZE } from './useIssueBoardColumns';

const page = (numbers: number[], parentNumber?: number) => ({
  pages: [{ items: numbers.map((n) => ({ number: n, parent: parentNumber ? { number: parentNumber } : null })) }],
  pageParams: [],
});

describe('findIssueInSearchCache', () => {
  it('다른 쿼리·페이지에 있는 이슈를 찾는다', () => {
    const qc = new QueryClient();
    qc.setQueryData(['issues', 'search', 'WP', 'a'], page([1, 2]));
    qc.setQueryData(['issues', 'search', 'WP', 'b'], page([3], 11));
    expect(findIssueInSearchCache(qc, 'WP', 3)?.parent?.number).toBe(11);
  });
  it('없거나 다른 프로젝트 캐시면 undefined', () => {
    const qc = new QueryClient();
    qc.setQueryData(['issues', 'search', 'XX', 'a'], page([1]));
    expect(findIssueInSearchCache(qc, 'WP', 1)).toBeUndefined();
  });
});

// copyIssueIntoStatusColumn — 보드 열 이동 뒤 재조회 응답 순서와 상관없이 카드가 사라지지 않게(WP-860).
// 보드 열은 프로젝트 상태 하나로 좁힌 쿼리(statusIds=[id], WP-808)라 대상 열을 상태 id 로 찾는다.
describe('copyIssueIntoStatusColumn', () => {
  const byId = (statusIds: number[], extra: Record<string, unknown> = {}) => ({ statuses: [], statusIds, ...extra });
  const col = (items: { number: number; status: string }[]) => ({ pages: [{ items, nextCursor: null }], pageParams: [null] });
  const numbers = (qc: QueryClient, key: unknown[]) =>
    (qc.getQueryData<ReturnType<typeof col>>(key)?.pages ?? []).flatMap((p) => p.items.map((it) => it.number));
  // 화면이 쓰는(관찰자가 붙은) 캐시 — 재조회하지 않도록 staleTime 을 무한으로 둔다.
  const watch = (qc: QueryClient, key: unknown[]) =>
    new QueryObserver(qc, { queryKey: key, queryFn: () => col([]), staleTime: Infinity }).subscribe(() => {});

  it('같은 필터의 대상 상태 열 캐시 맨 앞에 옮긴 카드를 넣는다', () => {
    const qc = new QueryClient();
    const size = BOARD_COLUMN_PAGE_SIZE;
    const todo = ['issues', 'search', 'WP', byId([11], { q: 'x' }), size];
    const review = ['issues', 'search', 'WP', byId([12], { q: 'x' }), size]; // 같은 범주(IN_PROGRESS)의 다른 상태 열
    const doing = ['issues', 'search', 'WP', byId([13], { q: 'x' }), size];
    qc.setQueryData(todo, col([{ number: 1, status: 'IN_PROGRESS' }, { number: 2, status: 'TODO' }]));
    qc.setQueryData(review, col([]));
    qc.setQueryData(doing, col([{ number: 3, status: 'IN_PROGRESS' }]));
    [review, doing].forEach((k) => watch(qc, k));
    copyIssueIntoStatusColumn(qc, 'WP', 1, 13);
    expect(numbers(qc, doing)).toEqual([1, 3]);
    expect(numbers(qc, review)).toEqual([]);
    // 원래 열 캐시는 건드리지 않는다 — 재조회가 빼 간다.
    expect(numbers(qc, todo)).toEqual([1, 2]);
  });

  it('이미 있거나·화면에 안 쓰이는 열·다른 필터·목록 크기 쿼리는 건드리지 않는다', () => {
    const qc = new QueryClient();
    const size = BOARD_COLUMN_PAGE_SIZE;
    const todo = ['issues', 'search', 'WP', byId([11]), size];
    const doing = ['issues', 'search', 'WP', byId([13]), size];
    const done = ['issues', 'search', 'WP', byId([14]), size];
    const otherFilter = ['issues', 'search', 'WP', byId([13], { q: 'y' }), size];
    const listTodo = ['issues', 'search', 'WP', byId([11], { q: 'z' }), 30];
    const listDoing = ['issues', 'search', 'WP', byId([13], { q: 'z' }), 30];
    qc.setQueryData(todo, col([{ number: 1, status: 'IN_PROGRESS' }]));
    qc.setQueryData(doing, col([{ number: 1, status: 'IN_PROGRESS' }]));
    qc.setQueryData(done, col([])); // 관찰자 없음 — 무효화가 재조회하지 않는다
    qc.setQueryData(otherFilter, col([]));
    qc.setQueryData(listTodo, col([{ number: 1, status: 'IN_PROGRESS' }]));
    qc.setQueryData(listDoing, col([]));
    [doing, otherFilter, listDoing].forEach((k) => watch(qc, k));
    copyIssueIntoStatusColumn(qc, 'WP', 1, 13);
    copyIssueIntoStatusColumn(qc, 'WP', 1, 14);
    expect(numbers(qc, doing)).toEqual([1]);
    expect(numbers(qc, done)).toEqual([]);
    expect(numbers(qc, otherFilter)).toEqual([]);
    expect(numbers(qc, listDoing)).toEqual([]);
  });
});
