// 왼쪽 에픽 패널 — 프로젝트의 EPIC 이슈 목록을 진행률과 함께 보여주고, 클릭한 에픽으로
// 이슈 검색을 단일 필터링한다(Jira 클래식 보드의 에픽 패널 패턴). 백엔드 변경 없이 기존
// type=EPIC 검색 + parent=<epicNumber> 필터 + childCount/childDoneCount 를 재사용한다.
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { cn } from '@/lib/utils';

import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { avatarColorClass } from '../../../lib/avatarColor';
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters';
import type { IssueFilters } from '../../../types/issue';

const COLLAPSE_STORAGE_KEY = 'epicSidePanel.collapsed';

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
  };
}

export function EpicSidePanel({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);
  const queryClient = useQueryClient();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true',
  );

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

  // EPIC 유형이 없는 프로젝트(PERSONAL 은 애초에 이 페이지로 오지 않지만 방어적으로 유지)에는
  // 패널 자체를 렌더링하지 않는다.
  if (!epicType) return null;

  const epics = epicSearch.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }

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

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label="에픽 패널 펼치기"
        data-testid="epic-panel-collapse-toggle"
        className="shrink-0 self-start rounded border p-1.5 text-muted-foreground hover:bg-accent"
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside
      aria-label="에픽 필터"
      data-testid="epic-side-panel"
      className="w-56 shrink-0 space-y-1 border-r pr-3"
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">에픽</span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="에픽 패널 접기"
          data-testid="epic-panel-collapse-toggle"
          className="rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          setParams(filtersToParams({ ...filters, parentNumber: null }, view, groupBy), { replace: true });
          invalidateBodyIssueSearch();
        }}
        aria-pressed={filters.parentNumber == null}
        data-testid="epic-filter-all"
        className={cn(
          'w-full rounded px-2 py-1.5 text-left text-sm',
          filters.parentNumber == null ? 'bg-accent font-medium' : 'hover:bg-accent/50',
        )}
      >
        전체 이슈
      </button>

      {epics.map((ep) => {
        const pct = ep.childCount > 0 ? Math.round((ep.childDoneCount / ep.childCount) * 100) : 0;
        const selected = filters.parentNumber === ep.number;
        return (
          <button
            key={ep.number}
            type="button"
            onClick={() => selectEpic(ep.number)}
            aria-pressed={selected}
            data-testid={`epic-filter-${ep.number}`}
            className={cn(
              'w-full rounded border-l-2 px-2 py-1.5 text-left text-sm',
              selected ? 'bg-accent font-medium' : 'hover:bg-accent/50',
            )}
          >
            <span className={cn('mr-1 inline-block h-2 w-2 rounded-full', avatarColorClass(ep.number).split(' ')[0])} />
            <span className="truncate">{ep.title}</span>
            <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
              <div
                className={cn('h-full', avatarColorClass(ep.number).split(' ')[0])}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {ep.childDoneCount}/{ep.childCount}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
