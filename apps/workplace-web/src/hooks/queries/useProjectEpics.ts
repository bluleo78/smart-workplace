// 프로젝트 에픽 목록 조회 — 에픽 패널과 프로젝트 페이지(드래그 전 미리 데우기)가 같은 캐시를 공유한다.
// 백엔드 변경 없이 type=EPIC 검색(topLevel, 진행 중 상태, 100건)을 재사용한다.
import type { IssueFilters } from '../../types/issue';
import { useIssueSearch } from './useIssueSearch';
import { useIssueTypes } from './useIssueTypes';

// EPIC 자체를 조회할 때 쓰는 필터 — typeIds 를 EPIC 으로, 상태를 진행 중(TODO·IN_PROGRESS)으로 좁힌다.
// 완료·취소된 에픽은 패널·선택 목록·드롭 대상에서 뺀다(WP-246). 종료 에픽 열람은 WP-245 에서 별도로 다룬다.
function epicListFilters(epicTypeId: number): IssueFilters {
  return {
    q: '',
    statuses: ['TODO', 'IN_PROGRESS'],
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

export function useProjectEpics(projectKey: string, enabled = true) {
  const types = useIssueTypes(projectKey);
  const epicType = types.data?.find((t) => t.name === 'EPIC');
  // 훅 순서 고정 — epicType 미확정 시 typeIds:[-1] 자리채움 + enabled=false 로 요청만 막는다.
  const epicSearch = useIssueSearch(
    projectKey,
    epicListFilters(epicType?.id ?? -1),
    100,
    enabled && !!epicType,
  );
  const epics = epicSearch.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 로딩: 유형 목록 로딩 중이거나, EPIC 유형 확정 후 에픽 검색 로딩 중.
  const loading = types.isLoading || (!!epicType && epicSearch.isLoading);
  return { epicType, epics, loading };
}
