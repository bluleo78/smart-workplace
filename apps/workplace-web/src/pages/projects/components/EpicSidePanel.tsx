// 왼쪽 에픽 패널 — 프로젝트의 EPIC 이슈 목록을 진행률과 함께 보여주고, 클릭한 에픽으로
// 이슈 검색을 단일 필터링한다(Jira 클래식 보드의 에픽 패널 패턴). 백엔드 변경 없이 기존
// type=EPIC 검색 + parent=<epicNumber> 필터 + childCount/childDoneCount 를 재사용한다.
// 열림/닫힘은 ViewChipBar 의 「에픽」 토글이 단일 진입점(조건 마운트).
import { useQueryClient } from '@tanstack/react-query';
import { Layers, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { avatarColorClass } from '../../../lib/avatarColor';
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters';
import type { IssueFilters } from '../../../types/issue';
import { IssueCreateDialog } from './IssueCreateDialog';

// EPIC 자체를 조회할 때 쓰는 필터 — 다른 필터는 모두 기본값, typeIds 만 EPIC 으로 좁힌다.
function epicListFilters(epicTypeId: number): IssueFilters {
  return {
    q: '',
    statuses: [],
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
  };
}

export function EpicSidePanel({
  projectKey, canCreateIssue = false,
}: { projectKey: string; canCreateIssue?: boolean }) {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);
  const queryClient = useQueryClient();
  // 「＋ 에픽 만들기」 다이얼로그 열림 상태.
  const [createOpen, setCreateOpen] = useState(false);

  const types = useIssueTypes(projectKey);
  const epicType = types.data?.find((t) => t.name === 'EPIC');

  // 훅 순서 고정을 위해 epicType 미확정 시에도 훅은 항상 호출하고, enabled 로 실제 네트워크 요청만 막는다.
  // (필터의 typeIds: [-1] 는 enabled=false 상태에서는 사용되지 않는 자리채움용일 뿐이다.)
  const epicSearch = useIssueSearch(
    projectKey,
    epicType ? epicListFilters(epicType.id) : epicListFilters(-1),
    100,
    !!epicType,
  );

  const epics = epicSearch.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 로딩: 유형 목록 로딩 중이거나, EPIC 유형 확정 후 에픽 검색 로딩 중.
  const loading = types.isLoading || (!!epicType && epicSearch.isLoading);

  // 에픽 필터 전환 후 본문 이슈 검색을 무효화한다 — 전역 staleTime(30s) 내 동일 필터로
  // 되돌아가도(예: 같은 에픽 재클릭) 캐시된 결과가 아니라 최신 목록을 즉시 다시 조회한다.
  function invalidateBodyIssueSearch() {
    queryClient.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
  }

  function selectEpic(epicNumber: number) {
    const next = filters.parentNumber === epicNumber ? null : epicNumber;
    setParams(filtersToParams({ ...filters, parentNumber: next }, view, groupBy), { replace: true });
    // 새 에픽 선택(next != null)은 필터/queryKey 자체가 새로 생겨 캐시가 stale-block 하지 않으므로
    // 무효화 불필요 — 선택 해제(재클릭으로 null 복귀)일 때만 무효화해 불필요한 패널 자체 재조회를 막는다.
    if (next === null) invalidateBodyIssueSearch();
  }

  // 「에픽 미할당」 = 기본 목록(topLevel) 중 유형이 EPIC 이 아닌 이슈.
  // 백엔드에 "부모 없음" 전용 파라미터가 없어 typeIds(전체 유형 − EPIC) 로 표현한다.
  const nonEpicTypeIds = (types.data ?? []).filter((t) => t.name !== 'EPIC').map((t) => t.id);
  // 활성 판정: parent 필터 없음 + typeIds 집합이 정확히 (전체 유형 − EPIC).
  // (FacetFilter 로 동일 집합을 직접 만든 경우도 활성으로 취급 — 의미상 동일 필터.)
  const sortedKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
  const unassignedActive =
    filters.parentNumber == null &&
    nonEpicTypeIds.length > 0 &&
    filters.typeIds.length > 0 &&
    sortedKey(filters.typeIds) === sortedKey(nonEpicTypeIds);

  // 미할당 토글 — 활성 상태에서 재클릭하면 유형 필터를 비워 「전체 이슈」 상태로 복귀.
  function selectUnassigned() {
    const next = unassignedActive ? [] : nonEpicTypeIds;
    setParams(filtersToParams({ ...filters, parentNumber: null, typeIds: next }, view, groupBy), {
      replace: true,
    });
    // 해제(빈 필터 복귀)는 캐시된 동일 queryKey 로 돌아가므로 무효화 필요(선택 해제와 동일 근거).
    if (unassignedActive) invalidateBodyIssueSearch();
  }

  return (
    <aside
      aria-label="에픽 필터"
      data-testid="epic-side-panel"
      className="flex w-56 shrink-0 flex-col self-stretch border-r pr-3"
    >
      {/* 헤더 — 레이블 + 에픽 개수. 접기 버튼 없음(진입점은 뷰 탭 바 토글). */}
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-medium text-muted-foreground">에픽</span>
        <span className="text-xs text-muted-foreground" data-testid="epic-panel-count">
          {epics.length}
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          // 미할당 유래 유형 필터(현재 typeIds === 전체 유형 − EPIC)만 함께 해제한다.
          // unassignedActive 플래그로 판정하면 안 된다 — 중간에 특정 에픽을 선택(selectEpic)해
          // parentNumber 만 바뀌고 typeIds 는 그대로 남는 경우, 클릭 시점의 unassignedActive 는
          // (parentNumber != null 이라) 이미 false 로 계산돼 있어 stale 한 typeIds 를 그대로
          // 들고 가버린다. 대신 현재 typeIds 집합 자체를 nonEpicTypeIds 와 직접 비교해 판정하면
          // parentNumber 값과 무관하게 항상 올바르게 해제된다. 사용자가 FacetFilter 로 건
          // 무관한 유형 필터는 이 집합과 다르므로 보존된다.
          const isUnassignedTypeIds =
            nonEpicTypeIds.length > 0 && sortedKey(filters.typeIds) === sortedKey(nonEpicTypeIds);
          setParams(
            filtersToParams(
              { ...filters, parentNumber: null, typeIds: isUnassignedTypeIds ? [] : filters.typeIds },
              view,
              groupBy,
            ),
            { replace: true },
          );
          invalidateBodyIssueSearch();
        }}
        aria-pressed={filters.parentNumber == null && !unassignedActive}
        data-testid="epic-filter-all"
        className={cn(
          'w-full rounded px-2 py-1.5 text-left text-sm transition-colors',
          filters.parentNumber == null && !unassignedActive ? 'bg-accent font-medium' : 'hover:bg-muted/50',
        )}
      >
        전체 이슈
      </button>

      {epicType && (
        <button
          type="button"
          onClick={selectUnassigned}
          aria-pressed={unassignedActive}
          data-testid="epic-filter-unassigned"
          className={cn(
            'w-full rounded px-2 py-1.5 text-left text-sm transition-colors',
            unassignedActive ? 'bg-accent font-medium' : 'hover:bg-muted/50',
          )}
        >
          에픽 미할당
        </button>
      )}

      <div className="my-2 border-t" />

      {/* 에픽 목록 — 내부 스크롤(헤더/고정 항목/푸터는 고정). */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 px-2 py-2" data-testid="epic-panel-skeleton">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-2 rounded-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                </div>
                <Skeleton className="ml-4 h-1 w-full rounded-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : epics.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center" data-testid="epic-panel-empty">
            {/* 빈 상태 — 아이콘+제목+설명(06-feedback-states §B). 다음 행동은 푸터 「＋ 에픽 만들기」. */}
            <Layers className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">아직 에픽이 없습니다</p>
            <p className="text-xs text-muted-foreground">
              에픽으로 큰 작업을 묶어 진행률을 추적할 수 있습니다
            </p>
          </div>
        ) : (
          epics.map((ep) => {
            const pct = ep.childCount > 0 ? Math.round((ep.childDoneCount / ep.childCount) * 100) : 0;
            const selected = filters.parentNumber === ep.number;
            // avatarColorClass 는 "bg-x-500 text-white" 복합 문자열 — 색점/진행바에는 bg-* 만 사용.
            const colorBg = avatarColorClass(ep.number).split(' ')[0];
            return (
              <button
                key={ep.number}
                type="button"
                onClick={() => selectEpic(ep.number)}
                aria-pressed={selected}
                data-testid={`epic-filter-${ep.number}`}
                className={cn(
                  'w-full rounded px-2 py-1.5 text-left text-sm transition-colors',
                  selected ? 'bg-accent font-medium' : 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', colorBg)} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" title={ep.title}>{ep.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {ep.childDoneCount}/{ep.childCount}
                  </span>
                </span>
                {/* 진행바 — FreshnessBar 패턴(h-1 rounded-full bg-muted 트랙 + 색 채움). button 내부라 span 만 사용. */}
                <span
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-1.5 ml-4 block h-1 overflow-hidden rounded-full bg-muted"
                >
                  <span className={cn('block h-full rounded-full', colorBg)} style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* 푸터 — 빈 상태의 "다음 행동"이자 상시 생성 진입점. 생성 권한 + EPIC 유형이 있을 때만. */}
      {canCreateIssue && epicType && (
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            data-testid="epic-create-button"
            onClick={() => setCreateOpen(true)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> 에픽 만들기
          </button>
          <IssueCreateDialog
            projectKey={projectKey}
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialTypeId={epicType.id}
          />
        </div>
      )}
    </aside>
  );
}
