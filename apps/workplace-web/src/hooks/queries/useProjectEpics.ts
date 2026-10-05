// 프로젝트 에픽 목록 조회 — 에픽 패널과 프로젝트 페이지(드래그 전 미리 데우기)가 같은 캐시를 공유한다.
// 백엔드 변경 없이 type=EPIC 검색(topLevel, 상태 필터, 100건)을 재사용한다.
import { useEffect } from 'react';

import type { IssueFilters } from '../../types/issue';
import { useIssueSearch } from './useIssueSearch';
import { useIssueTypes } from './useIssueTypes';

// 진행 중 에픽 — 패널 기본 목록·선택 칩·드롭 대상(WP-246).
const OPEN_EPIC_STATUSES = ['TODO', 'IN_PROGRESS'];
// 종료된 에픽 — 패널·모바일 시트의 접힌 「종료된 에픽」 구역 전용(WP-245). 드롭 대상·선택 칩에는 쓰지 않는다.
const CLOSED_EPIC_STATUSES = ['DONE', 'CANCELED'];

// EPIC 자체를 조회할 때 쓰는 필터 — typeIds 를 EPIC 으로, 상태를 주어진 목록으로 좁힌다.
function epicListFilters(epicTypeId: number, statuses: string[]): IssueFilters {
  return {
    q: '',
    statuses,
    priorities: [],
    assigneeIds: [],
    includeUnassigned: false,
    dueFrom: null,
    dueTo: null,
    labelIds: [],
    cycleIds: [],
    milestoneIds: [],
    typeIds: [epicTypeId],
    parentNumber: null,
    topLevel: true,
    blocked: false,
    excludeSubtasks: false,
    showAllClosed: false,
  };
}

// 상태 목록별 에픽 검색 — 필터가 다르면 쿼리 키도 달라 진행 중·종료 캐시가 자동으로 나뉜다.
function useEpicList(projectKey: string, statuses: string[], enabled: boolean) {
  const types = useIssueTypes(projectKey);
  const epicType = types.data?.find((t) => t.name === 'EPIC');
  // 훅 순서 고정 — epicType 미확정 시 typeIds:[-1] 자리채움 + enabled=false 로 요청만 막는다.
  const epicSearch = useIssueSearch(projectKey, epicListFilters(epicType?.id ?? -1, statuses), 100, enabled && !!epicType);
  const epics = epicSearch.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 로딩: 유형 목록 로딩 중이거나, EPIC 유형 확정 후 첫 페이지 로딩 중(isLoading 은 데이터가 없을 때만 참 — 뒤 페이지 로딩은 해당 없음).
  const loading = types.isLoading || (!!epicType && epicSearch.isLoading);
  return { epicType, epics, loading, epicSearch };
}

export function useProjectEpics(projectKey: string, enabled = true) {
  const { epicType, epics, loading } = useEpicList(projectKey, OPEN_EPIC_STATUSES, enabled);
  return { epicType, epics, loading };
}

export function useClosedEpics(projectKey: string, enabled = true) {
  const { epics, loading, epicSearch } = useEpicList(projectKey, CLOSED_EPIC_STATUSES, enabled);
  // 종료 에픽은 계속 쌓여 100건을 넘을 수 있다 — 개수·자동 펼침·칩 라벨이 맞도록 전량을 받는다.
  // 쿼리 객체 전체가 아니라 페이지 상태만 의존해 상태 변화마다 이펙트가 다시 돌지 않게 한다.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = epicSearch;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return { epics, loading };
}
