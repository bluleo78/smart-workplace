// 보드 상태 컬럼별 무한 스크롤 쿼리 (#875, WP-808).
// 왜: 보드 전체를 하나의 쿼리로 받으면 페이지가 정렬 순서대로 섞여 와서, 특정 컬럼의 카드가
//     뒤 페이지에 있을 때 그 컬럼만 조용히 비어 보인다(기존 200건 상한). 컬럼마다 프로젝트 상태(statusId)로 좁힌
//     독립 쿼리를 두면 각 컬럼이 자기 끝까지 스크롤하며 다음 페이지를 이어 받을 수 있다.
// 컬럼 수는 프로젝트 상태 수라 정해져 있지 않다(WP-808) — 훅 규칙상 반복 호출할 수 없고, useQueries 는 무한 쿼리를
// 지원하지 않는다(내부 QueriesObserver 가 일반 QueryObserver 만 만든다). 그래서 useBaseQuery 와 같은 방식으로
// 컬럼마다 InfiniteQueryObserver 를 두고 커밋 뒤 관찰자 단위로 구독한다.

import {
  type DefaultedInfiniteQueryObserverOptions,
  type InfiniteData,
  InfiniteQueryObserver,
  notifyManager,
  type QueryKey,
  type UseInfiniteQueryResult,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useReducer, useState } from 'react';

import type { IssueFilters, IssueSearchResponse } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';
import { issueSearchOptions } from './useIssueSearch';

// 컬럼당 한 페이지 크기 — 여러 컬럼 첫 렌더가 수백 장을 넘지 않도록 50.
export const BOARD_COLUMN_PAGE_SIZE = 50;

export type BoardColumnQuery = UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>;

type ColumnObserver = InfiniteQueryObserver<
  IssueSearchResponse,
  Error,
  InfiniteData<IssueSearchResponse>,
  QueryKey,
  string | null
>;
type ColumnOptions = DefaultedInfiniteQueryObserverOptions<
  IssueSearchResponse,
  Error,
  InfiniteData<IssueSearchResponse>,
  QueryKey,
  string | null
>;

/**
 * 컬럼(프로젝트 상태)에 맞춘 필터 — 그 상태 하나로 좁힌다(statusIds=[id]).
 * 사용자가 「상태 범주」(statuses) 또는 「상태」(statusIds) 필터로 이 컬럼을 제외하면 null(쿼리 비활성) —
 * 그대로 흘리면 다른 상태 카드가 이 컬럼 쿼리에 섞이거나 API 가 빈 결과를 위해 헛요청을 한다.
 */
export function columnFilters(filters: IssueFilters, status: ProjectStatus): IssueFilters | null {
  if (filters.statuses.length > 0 && !filters.statuses.includes(status.category)) return null;
  if (filters.statusIds.length > 0 && !filters.statusIds.includes(status.id)) return null;
  return { ...filters, statusIds: [status.id] };
}

/**
 * 컬럼 상태 목록대로 쿼리 결과를 돌려준다(statusId → query).
 * enabled=false 이면(담당자·우선순위 그룹 보드) 모든 컬럼 쿼리를 끈다. 비활성·제외 컬럼은 undefined —
 * 관찰자 자체를 만들지 않으므로 다른 컬럼 키의 data·hasNextPage 가 제외 컬럼에 새지 않는다(「0+」·sentinel 누수 방지).
 */
export function useIssueBoardColumns(
  projectKey: string,
  filters: IssueFilters,
  statuses: ProjectStatus[],
  enabled = true,
): Record<number, BoardColumnQuery | undefined> {
  const client = useQueryClient();
  // 활성 컬럼의 옵션 — 매 렌더 기본값을 입혀 만든다(useBaseQuery 와 같다). optimistic 표시는 새 컬럼 첫 렌더가
  // 「대기」가 아니라 곧 받을 「불러오는 중」 결과를 돌려주게 한다.
  const specs: { id: number; options: ColumnOptions }[] = [];
  if (enabled) {
    for (const s of statuses) {
      const f = columnFilters(filters, s);
      if (!f) continue;
      const options = client.defaultQueryOptions(
        issueSearchOptions(projectKey, f, BOARD_COLUMN_PAGE_SIZE),
      ) as unknown as ColumnOptions;
      options._optimisticResults = 'optimistic';
      specs.push({ id: s.id, options });
    }
  }

  // 관찰자 보관소 — statusId 별로 하나. 컬럼이 다시 활성되거나 필터가 바뀌어도 같은 관찰자가 키만 옮긴다.
  // 렌더에서는 「없으면 만들기」만 한다 — 렌더는 버려질 수 있으므로(라우터 setSearchParams 의 transition 등)
  // 삭제·구독 정리는 커밋 뒤(아래 effect)에서만 한다. 그래야 버려진 렌더가 관찰자를 지워 구독되지 않은 사본이 남지 않는다.
  const [store] = useState(() => new Map<number, ColumnObserver>());
  const observers = specs.map(({ id, options }) => {
    let o = store.get(id);
    if (!o) {
      o = new InfiniteQueryObserver(client, options) as ColumnObserver;
      store.set(id, o);
    }
    return o;
  });

  // 어느 컬럼 결과가 바뀌어도 보드를 다시 그린다.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // 지금 구독 중인 관찰자 — 관찰자 단위로 붙이고 뗀다(컬럼 하나가 늘거나 빠져도 다른 컬럼은 재구독·재조회하지 않는다).
  const [subs] = useState(() => new Map<number, { observer: ColumnObserver; unsubscribe: () => void }>());

  // 커밋 뒤 구독 맞추기 — 빠진 컬럼·교체된 관찰자는 떼고, 새 관찰자는 붙인 뒤 옵션(필터·키)을 반영한다.
  useEffect(() => {
    const wanted = new Map(specs.map((s, i) => [s.id, observers[i]] as const));
    for (const [id, sub] of subs) {
      if (wanted.get(id) !== sub.observer) {
        sub.unsubscribe();
        subs.delete(id);
      }
    }
    // 보관소 정리 — 커밋된 활성 컬럼에 없는 관찰자는 버린다(다시 활성되면 새로 만들어 붙인다).
    for (const id of [...store.keys()]) if (!wanted.has(id)) store.delete(id);
    specs.forEach((s, i) => {
      const o = observers[i];
      if (!subs.has(s.id)) {
        // 새로 붙이는 관찰자는 현재 옵션을 먼저 입힌다 — 만든 뒤 키가 바뀌었으면 구독 시점에 옛 키로 조회하지 않게.
        o.setOptions(s.options);
        subs.set(s.id, { observer: o, unsubscribe: o.subscribe(notifyManager.batchCalls(rerender)) });
        // 렌더와 구독 사이에 바뀐 결과를 반영한다(useBaseQuery 와 같다) — 바뀌었으면 리스너가 불린다.
        o.updateResult();
      } else {
        // 구독 중인 관찰자 — 키가 바뀌면 새 쿼리로 옮겨 가며 필요하면 받는다.
        o.setOptions(s.options);
      }
    });
  });
  // 언마운트 — 모든 구독을 뗀다(StrictMode 재마운트 시 위 effect 가 비어 있는 subs 를 보고 다시 붙인다).
  useEffect(
    () => () => {
      subs.forEach((sub) => sub.unsubscribe());
      subs.clear();
    },
    [subs],
  );

  const result: Record<number, BoardColumnQuery | undefined> = {};
  observers.forEach((o, i) => {
    result[specs[i].id] = o.getOptimisticResult(specs[i].options) as BoardColumnQuery;
  });
  return result;
}
