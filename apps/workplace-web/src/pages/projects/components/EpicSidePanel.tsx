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

  // 패널의 세 선택지(전체·미할당·특정 에픽)는 parent/topLevel 두 값의 조합이다 — 한 곳에서만 URL 에 반영해
  // 서로 배타가 깨지지 않게 한다. 사용자가 건 유형 등 다른 필터는 보존.
  // invalidate: 캐시된 동일 queryKey 로 되돌아가는 전환(해제)일 때만 true — 새 필터는 queryKey 가 새로 생겨 불필요.
  function applyEpicScope(parentNumber: number | null, topLevel: boolean, invalidate: boolean) {
    setParams(filtersToParams({ ...filters, parentNumber, topLevel }, view, groupBy), { replace: true });
    if (invalidate) invalidateBodyIssueSearch();
  }

  function selectEpic(epicNumber: number) {
    const next = filters.parentNumber === epicNumber ? null : epicNumber;
    // 「에픽 미할당」(topLevel)과 상호 배타 — 에픽을 고르면 미할당은 해제된다. 재클릭(null 복귀)만 무효화.
    applyEpicScope(next, false, next === null);
  }

  // 「에픽 미할당」 = 부모 없는(topLevel) 비EPIC 이슈. 보드·목록 기본 범위가 EPIC 을 이미 제외하므로
  // topLevel=true 하나로 표현된다(유형 필터는 건드리지 않음 — 사용자가 건 유형 필터와 독립).
  const unassignedActive = filters.parentNumber == null && filters.topLevel;

  // 미할당 토글 — 활성 상태에서 재클릭하면 「전체 이슈」 상태로 복귀.
  function selectUnassigned() {
    applyEpicScope(null, !unassignedActive, unassignedActive);
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
        // 에픽 선택·미할당을 모두 해제한다.
        onClick={() => applyEpicScope(null, false, true)}
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
