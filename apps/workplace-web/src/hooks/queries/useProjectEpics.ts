// 프로젝트 에픽 목록 조회 — 에픽 패널·선택 칩·이동 메뉴와 프로젝트 페이지(드래그 전 미리 데우기)가 같은 캐시를 공유한다.
// 백엔드 변경 없이 type=EPIC 검색(topLevel, 상태 필터, 100건)을 재사용한다.
// 패널 위쪽 목록(usePanelEpics)은 진행 중 에픽 + 진행 중 사이클에 할당된 종료 에픽, 선택 칩·이동 메뉴(useProjectEpics)는 그중 진행 중 에픽만.
import { useEffect } from 'react';

import { isClosedStatus } from '../../lib/issueGrouping';
import type { IssueFilters } from '../../types/issue';
import { useIssueSearch } from './useIssueSearch';
import { useIssueTypes } from './useIssueTypes';

// 종료된 에픽 — 패널·모바일 시트의 접힌 「종료된 에픽」 구역 조회(WP-245).
const CLOSED_EPIC_STATUSES = ['DONE', 'CANCELED'];

// EPIC 자체를 조회할 때 쓰는 필터 — typeIds 를 EPIC 으로, 상태를 주어진 목록으로 좁힌다(빈 목록 = 상태 무관).
// activeCycleOnly: 종료 에픽은 진행 중(ACTIVE) 사이클에 할당된 것만 남긴다 — 보드·목록의 종료 이슈 숨김 규칙(#876)을 그대로 쓴다.
function epicListFilters(epicTypeId: number, statuses: string[], activeCycleOnly: boolean): IssueFilters {
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
    hideInactiveClosed: activeCycleOnly,
  };
}

// 상태 목록별 에픽 검색 — 필터가 다르면 쿼리 키도 달라 진행 중·종료 캐시가 자동으로 나뉜다.
function useEpicList(projectKey: string, statuses: string[], enabled: boolean, activeCycleOnly = false) {
  const types = useIssueTypes(projectKey);
  const epicType = types.data?.find((t) => t.name === 'EPIC');
  // 훅 순서 고정 — epicType 미확정 시 typeIds:[-1] 자리채움 + enabled=false 로 요청만 막는다.
  const epicSearch = useIssueSearch(projectKey, epicListFilters(epicType?.id ?? -1, statuses, activeCycleOnly), 100, enabled && !!epicType);
  const epics = epicSearch.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 로딩: 유형 목록 로딩 중이거나, EPIC 유형 확정 후 첫 페이지 로딩 중(isLoading 은 데이터가 없을 때만 참 — 뒤 페이지 로딩은 해당 없음).
  const loading = types.isLoading || (!!epicType && epicSearch.isLoading);
  return { epicType, epics, loading, epicSearch };
}

// 에픽 패널·모바일 에픽 시트의 위쪽 목록(WP-389) — 진행 중 에픽 + 진행 중 사이클에 할당된 종료 에픽.
// 상태 필터 없이 hideInactiveClosed 만 걸면 미종료는 그대로 통과하고 종료는 ACTIVE 사이클 소속만 남아 한 번의 조회로 끝난다.
// 사이클이 끝나면(COMPLETED) 조건에서 빠져 「종료된 에픽」 구역으로 내려간다. 진행 중 에픽을 먼저, 종료 에픽을 뒤에 둔다.
export function usePanelEpics(projectKey: string, enabled = true) {
  const { epicType, epics, loading } = useEpicList(projectKey, [], enabled, true);
  const ordered = [...epics.filter((e) => !isClosedStatus(e.status)), ...epics.filter((e) => isClosedStatus(e.status))];
  return { epicType, epics: ordered, loading };
}

// 진행 중 에픽 — 선택 칩·이동 메뉴·생성 시 부모 선택(WP-246). 위쪽 목록 조회에서 종료 에픽만 걸러 같은 캐시를 쓴다
// (상태는 할 일·진행 중·완료·취소 넷뿐이라 「종료 아님」 = 할 일·진행 중).
export function useProjectEpics(projectKey: string, enabled = true) {
  const { epicType, epics, loading } = usePanelEpics(projectKey, enabled);
  return { epicType, epics: epics.filter((e) => !isClosedStatus(e.status)), loading };
}

// 「종료된 에픽」 구역 목록 — 위쪽 목록에 올라간(진행 중 사이클 소속) 종료 에픽은 뺀다(WP-389).
// 위쪽 목록이 오기 전에는 비워 둔다 — 먼저 도착한 종료 목록에 같은 에픽이 위아래로 겹쳐 보이지 않게.
export function useClosedEpics(projectKey: string, enabled = true) {
  const { epics, epicSearch } = useEpicList(projectKey, CLOSED_EPIC_STATUSES, enabled);
  const panel = usePanelEpics(projectKey, enabled);
  // 종료 에픽은 계속 쌓여 100건을 넘을 수 있다 — 개수·자동 펼침·칩 라벨이 맞도록 전량을 받는다.
  // 쿼리 객체 전체가 아니라 페이지 상태만 의존해 상태 변화마다 이펙트가 다시 돌지 않게 한다.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = epicSearch;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (panel.loading) return { epics: [] };
  const shownAbove = new Set(panel.epics.map((e) => e.number));
  return { epics: epics.filter((e) => !shownAbove.has(e.number)) };
}
