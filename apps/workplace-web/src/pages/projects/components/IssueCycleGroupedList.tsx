// 이슈 목록 「사이클」 그룹(#878) — Jira 백로그 방식: 진행 중 사이클 → 예정 사이클 → 백로그(진행 중·예정 사이클 밖) 구간.
// 구간마다 독립 쿼리(현재 필터 + 구간 조건)라 평면 목록 쿼리는 띄우지 않는다. 선택·일괄 작업은 구간을 가로질러 공유한다
// (한 이슈가 여러 사이클에 속하면 각 구간에 모두 보이고, 선택 상태도 이슈 number 로 하나를 공유한다).

import { useCallback, useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useCycleProgress, useCycles } from '../../../hooks/queries/useCycles';
import { useIssueSelection } from '../../../hooks/useIssueSelection';
import { buildCycleSections } from '../../../lib/issueCycleSections';
import { filtersToParams } from '../../../lib/issueFilters';
import type { CycleProgress } from '../../../types/cycle';
import type { IssueFilters } from '../../../types/issue';
import { useIssueRowActions } from '../hooks/useIssueRowActions';
import { IssueBulkActions } from './IssueBulkActions';
import { CycleSectionColumnHead, CycleSectionSkeletonRows, IssueCycleSection } from './IssueCycleSection';
import { IssueFilterEmptyState } from './IssueFilterEmptyState';

/** 목록 로딩 스켈레톤 — 구간 헤더 모양 + 행 3줄. 기본 그룹 판정 보류 중(ProjectDetailPage)에도 같은 모양을 쓴다. */
export function IssueCycleListSkeleton() {
  return (
    <div className="space-y-3" data-testid="issue-list-pending" aria-busy="true" aria-label="이슈 목록 불러오는 중">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-md border pl-3">
          <div className="-ml-3 flex items-center gap-3 bg-muted/40 py-2 pl-12 pr-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
          <table className="w-full border-t">
            <tbody>
              <CycleSectionSkeletonRows />
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function IssueCycleGroupedList({
  projectKey,
  filters,
  canDrag = false,
}: {
  projectKey: string;
  filters: IssueFilters;
  /** 프로젝트 멤버만 행을 에픽 패널로 끌 수 있다 — 평면 목록과 같은 행(IssueRow)이라 동작도 같다. */
  canDrag?: boolean;
}) {
  const isMobile = useIsMobile();
  const cycles = useCycles(projectKey);
  const progress = useCycleProgress(projectKey);

  // 다중 선택 — 이슈 number 집합(구간 공통). 필터(직렬화 값)가 바뀌면 이전 기준 선택은 의미가 없어 초기화한다.
  const filterKey = filtersToParams(filters, 'list', null).toString();
  const hasActiveFilters = filterKey !== '';
  const { selected, toggle: toggleSelected, clear: clearSelected } = useIssueSelection(filterKey);

  // 모바일 길게 누르기 액션 — 시트는 구간 밖(목록 레벨)에서 하나만 소유한다.
  const rowActions = useIssueRowActions({ projectKey, canEdit: canDrag, onSelect: (i) => toggleSelected(i.number) });

  const sections = useMemo(
    () => buildCycleSections(cycles.data ?? [], filters.cycleIds),
    [cycles.data, filters.cycleIds],
  );

  // 구간 펼침 상태 — 사용자가 토글한 구간만 기록하고 나머지는 구간 기본값(진행 중·백로그 펼침, 예정 접힘)을 따른다.
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const isExpanded = (key: string, fallback: boolean) => expandedOverrides[key] ?? fallback;
  const toggleExpanded = useCallback(
    (key: string) => {
      setExpandedOverrides((prev) => {
        const def = sections.find((s) => s.key === key);
        const current = prev[key] ?? def?.defaultExpanded ?? false;
        return { ...prev, [key]: !current };
      });
    },
    [sections],
  );

  const progressById = useMemo(() => {
    const m = new Map<number, CycleProgress>();
    (progress.data ?? []).forEach((p) => m.set(p.cycleId, p));
    return m;
  }, [progress.data]);

  // 남은 일수(D-N) 기준 — 렌더마다 새 Date 를 만들면 구간끼리 자정 경계에서 어긋날 수 있어 한 번만 잡는다.
  const [now] = useState(() => new Date());

  if (cycles.isLoading) return <IssueCycleListSkeleton />;

  // 사이클 필터로 고른 사이클이 목록에 없으면(삭제 등) 보여줄 구간이 없다 — 평면 목록 빈 상태와 같은 구성(필터 초기화 포함).
  if (sections.length === 0) {
    return (
      <IssueFilterEmptyState
        title="조건에 맞는 사이클이 없습니다"
        description="선택한 사이클이 삭제되었을 수 있습니다. 필터를 초기화해 보세요."
      />
    );
  }

  return (
    <div data-testid="issue-cycle-grouped-list">
      <IssueBulkActions projectKey={projectKey} selected={selected} onClear={clearSelected} />
      {/* 컬럼명 — 구간마다 반복하지 않고 첫 구간 위에 한 번만. 구간과 같은 테두리·여백(border+pl-3)으로 컬럼을 맞춘다.
          구간 테이블마다 스크린리더용 컬럼명이 있으므로 이 행은 보조기기에서 숨긴다. */}
      <div className="border border-transparent pl-3" aria-hidden="true">
        <table className="w-full table-fixed">
          <CycleSectionColumnHead visible />
        </table>
      </div>
      <div className="flex flex-col gap-3">
        {sections.map((def) => (
          <IssueCycleSection
            key={def.key}
            def={def}
            expanded={isExpanded(def.key, def.defaultExpanded)}
            onToggleExpanded={toggleExpanded}
            projectKey={projectKey}
            filters={filters}
            hasActiveFilters={hasActiveFilters}
            progress={def.kind === 'cycle' ? progressById.get(def.cycle.id) : undefined}
            now={now}
            selected={selected}
            onToggleSelect={toggleSelected}
            canDrag={canDrag}
            onLongPress={isMobile ? rowActions.open : undefined}
            selectionMode={isMobile && selected.size > 0}
          />
        ))}
      </div>
      {/* 모바일 일괄 작업 바(fixed, 약 56px)가 마지막 행을 가리지 않게 같은 높이만큼 비운다. */}
      {isMobile && selected.size > 0 && <div aria-hidden className="h-16" />}
      {rowActions.sheets}
    </div>
  );
}
