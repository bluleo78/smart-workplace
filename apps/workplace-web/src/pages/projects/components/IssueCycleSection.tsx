// 이슈 목록 사이클 구간(#878) — 헤더(펼침 토글·이름·상태·기간·남은 일수·진행률/건수·목표) + 펼치면 이슈 행 테이블.
// 구간 하나 = <section> 하나로 분리해 두어 이후 드래그 앤 드롭(#881)에서 구간 전체를 드롭 대상으로 감싸기 쉽게 한다.
// 행은 평면 목록과 같은 IssueRow 를 쓰고, 선택 상태는 목록 전체(IssueCycleGroupedList)가 공유한다.

import { ChevronRight } from 'lucide-react';
import { useId, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeType } from '@/components/ui/status-badge';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { cn } from '@/lib/utils';

import { CycleProgressBar } from '../../../components/cycle/CycleProgressBar';
import { useCycleSectionIssues } from '../../../hooks/queries/useCycleSectionIssues';
import { useLoadMoreSentinel } from '../../../hooks/useLoadMoreSentinel';
import {
  backlogSectionFilters,
  type CycleSectionDef,
  cycleSectionFilters,
  remainingLabel,
} from '../../../lib/issueCycleSections';
import type { CycleProgress } from '../../../types/cycle';
import { CYCLE_STATUS_LABEL } from '../../../types/cycle';
import type { IssueFilters, IssueResponse } from '../../../types/issue';
import { IssueRow } from './IssueListRow';

// 비활성(접힘) 구간용 자리표시 — 훅 규칙상 sentinel 훅은 항상 호출되므로 아무 일도 하지 않는 쿼리를 준다.
const IDLE_QUERY = {
  hasNextPage: false,
  isFetching: false,
  isFetchNextPageError: false,
  fetchNextPage: () => Promise.resolve() as never,
};

// 상태 배지 문구 — 목록 구간에선 PLANNED 를 「예정」으로 부른다(구간 순서 설명과 같은 말).
const STATUS_BADGE_LABEL: Record<string, string> = { ...CYCLE_STATUS_LABEL, PLANNED: '예정' };
// 상태 배지 의미 — 디자인 시스템 StatusBadge 매핑(진행 중=info, 예정=pending, 완료=inactive).
const STATUS_BADGE_TYPE: Record<string, StatusBadgeType> = {
  ACTIVE: 'info',
  PLANNED: 'pending',
  COMPLETED: 'inactive',
};

// 기간 짧은 표기(모바일) — yyyy-MM-dd → M/D. 좁은 헤더에서 기간·진행률을 한 줄에 담기 위함.
function shortDate(d: string | null): string {
  if (!d) return '—';
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}`;
}

/**
 * 구간 테이블 컬럼 폭 정의 행 — 모든 구간과 목록 상단 컬럼명 행이 같은 폭을 쓰게 공유한다(table-fixed 는 첫 행이 폭을 정한다).
 * visible=false 면 0 높이(스크린리더엔 컬럼명), true 면 목록 상단에 한 번 보이는 컬럼명 행.
 * 좁은 화면(<sm)에선 우선순위·마감 컬럼을 숨기고 ID·담당자 폭을 줄인다(IssueRow 와 같은 규칙).
 */
export function CycleSectionColumnHead({ visible = false }: { visible?: boolean }) {
  const cell = visible ? 'py-1.5 text-left text-xs font-normal text-muted-foreground' : 'h-0 p-0 overflow-hidden';
  return (
    <thead>
      <tr className={cn(!visible && 'h-0')}>
        <th className={cn('w-9', cell)}><span className="sr-only">선택</span></th>
        <th className={cn('w-9', cell)}><span className="sr-only">상태</span></th>
        <th className={cn('hidden w-9 sm:table-cell', cell)}><span className="sr-only">우선순위</span></th>
        <th className={cn('w-16 sm:w-28', cell)}><span className={cn(!visible && 'sr-only')}>ID</span></th>
        <th className={cell}><span className={cn(!visible && 'sr-only')}>제목</span></th>
        <th className={cn('w-12 sm:w-20', cell)}><span className={cn(!visible && 'sr-only')}>담당자</span></th>
        <th className={cn('hidden w-32 sm:table-cell', cell)}>
          <span className={cn(!visible && 'sr-only')}>마감</span>
        </th>
      </tr>
    </thead>
  );
}

/** 구간 행 로딩 스켈레톤 — 구간 본문과 목록 전체 스켈레톤(IssueCycleListSkeleton)이 같은 모양을 쓴다. */
export function CycleSectionSkeletonRows() {
  return <TableSkeletonRows columns={4} rows={3} widths={['w-4', 'w-12', 'w-full', 'w-6']} />;
}

export function IssueCycleSection({
  def,
  expanded,
  onToggleExpanded,
  projectKey,
  filters,
  hasActiveFilters,
  progress,
  now,
  selected,
  onToggleSelect,
  onSetSelected,
  canDrag = false,
}: {
  def: CycleSectionDef;
  expanded: boolean;
  onToggleExpanded: (key: string) => void;
  projectKey: string;
  /** 사용자 필터(URL) — 구간 조건은 이 안에서 덧붙인다. */
  filters: IssueFilters;
  /** 사용자 필터가 걸려 있는지 — 빈 구간 문구를 "조건에 맞는 이슈 없음"으로 바꾼다. */
  hasActiveFilters: boolean;
  progress: CycleProgress | undefined;
  /** 남은 일수 기준 시각 — 목록이 한 번 정해 모든 구간이 같은 날짜로 계산하게 한다. */
  now: Date;
  selected: Set<number>;
  onToggleSelect: (number: number) => void;
  /** 구간 전체 선택/해제 — 여러 구간에 걸친 선택은 목록이 합쳐 관리한다. */
  onSetSelected: (numbers: number[], checked: boolean) => void;
  /** 프로젝트 멤버만 행을 에픽 패널로 끌 수 있다. */
  canDrag?: boolean;
}) {
  const bodyId = useId();
  const cycle = def.kind === 'cycle' ? def.cycle : null;
  const sectionFilters = useMemo(
    () => (cycle ? cycleSectionFilters(filters, cycle.id) : backlogSectionFilters(filters)),
    [filters, cycle],
  );
  const query = useCycleSectionIssues(projectKey, sectionFilters, expanded);
  const sentinelRef = useLoadMoreSentinel(query ?? IDLE_QUERY);
  const items = useMemo(
    () => query?.data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [],
    [query?.data],
  );

  const active = cycle?.status === 'ACTIVE';
  const title = cycle ? cycle.name : '백로그';
  // 남은 일수는 진행 중 사이클에만 의미가 있다(예정·완료는 기간만).
  const remaining = active && cycle ? remainingLabel(cycle.endDate, now) : null;
  const numbers = items.map((it) => it.number);
  const allSelected = numbers.length > 0 && numbers.every((n) => selected.has(n));
  // 백로그 헤더 건수 — 로드된 행 수이고, 다음 페이지가 남았으면 "+" 로 하한임을 알린다.
  // 사이클 구간은 건수 대신 진행률을 보인다 — 행은 에픽·SUBTASK 를 뺀 범위라 progress(전체 기준)와 숫자가 어긋나기 때문.
  const backlogCount =
    !cycle && query?.data ? `${items.length}${query.hasNextPage ? '+' : ''}건` : null;

  const emptyText = sectionEmptyText(hasActiveFilters, cycle !== null, progress?.total ?? 0);

  const hasPeriod = !!cycle && !!(cycle.startDate || cycle.endDate);

  return (
    <section
      data-testid={`list-cycle-section-${def.key}`}
      data-active={active ? 'true' : undefined}
      data-expanded={expanded ? 'true' : 'false'}
      aria-label={title}
      // 모든 구간이 같은 테두리·왼쪽 여백(pl-1)을 가져 컬럼이 어긋나지 않는다. 진행 중 강조선은 그 여백 위에 겹쳐 그리는
      // before: 오버레이라 레이아웃에 영향이 없다(border-l-4 를 쓰면 진행 중 구간만 컬럼이 밀린다).
      className={cn(
        'relative min-w-0 overflow-hidden rounded-md border pl-1',
        active && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary before:content-['']",
      )}
    >
      {/* 헤더 — 기존 그룹 헤더(bg-muted/40)와 같은 톤, 진행 중만 옅은 primary 틴트로 강조. -ml-1 pl-1 로 배경을 왼쪽 여백까지 채운다. */}
      <div
        className={cn(
          '-ml-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 pl-1 pr-3',
          active ? 'bg-primary/5 dark:bg-primary/10' : 'bg-muted/40',
        )}
        data-testid={`list-cycle-header-${def.key}`}
      >
        <div className="flex min-w-0 flex-[1_1_12rem] items-center">
          {/* 행 체크박스 컬럼(w-9)과 같은 폭의 슬롯 — 구간 전체 선택. 행이 보일 때만 노출. */}
          <span className="flex w-9 shrink-0">
            {numbers.length > 0 && (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSetSelected(numbers, !allSelected)}
                aria-label={`${title} 구간 전체 선택`}
                data-testid={`list-cycle-select-all-${def.key}`}
                className="h-4 w-4"
              />
            )}
          </span>
          <button
            type="button"
            onClick={() => onToggleExpanded(def.key)}
            aria-expanded={expanded}
            // 접힌 동안엔 본문이 렌더되지 않으므로 존재하지 않는 id 를 가리키지 않게 뺀다.
            aria-controls={expanded ? bodyId : undefined}
            data-testid={`list-cycle-toggle-${def.key}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90',
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate text-sm font-semibold" title={title}>
              {title}
            </span>
            {cycle && (
              <StatusBadge
                type={STATUS_BADGE_TYPE[cycle.status] ?? 'unknown'}
                className="shrink-0"
                data-testid={`list-cycle-badge-${def.key}`}
              >
                {active && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
                {STATUS_BADGE_LABEL[cycle.status] ?? cycle.status}
              </StatusBadge>
            )}
            {backlogCount && (
              <span
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
                data-testid={`list-cycle-count-${def.key}`}
              >
                {backlogCount}
              </span>
            )}
          </button>
        </div>
        {/* 메타(기간·남은 일수·진행률) — 한 줄. 좁은 화면에선 이름 아래 줄로 내려가며 제목 첫 글자에 맞춰 들여쓴다
            (체크박스 슬롯 w-9 + chevron 1rem + gap 0.5rem = 3.75rem). 기간은 짧은 표기(M/D)로 줄여 한 줄에 담는다. */}
        {cycle && (
          <div className="flex min-w-0 items-center gap-x-3 pl-[3.75rem] text-xs text-muted-foreground sm:pl-0">
            {hasPeriod && (
              <>
                <span className="tabular-nums sm:hidden">
                  {shortDate(cycle.startDate)} ~ {shortDate(cycle.endDate)}
                </span>
                <span className="hidden tabular-nums sm:inline" data-testid={`list-cycle-period-${def.key}`}>
                  {cycle.startDate ?? '—'} ~ {cycle.endDate ?? '—'}
                </span>
              </>
            )}
            {remaining && (
              <span
                data-testid={`list-cycle-remaining-${def.key}`}
                aria-label={remaining.ariaLabel}
                className={cn(
                  'shrink-0 font-medium tabular-nums',
                  remaining.overdue ? 'text-destructive' : 'text-primary',
                )}
              >
                {remaining.text}
              </span>
            )}
            <CycleProgressBar
              compact
              progress={progress ?? { cycleId: cycle.id, total: 0, done: 0, byStatus: {} }}
            />
          </div>
        )}
        {/* 목표 — 넓은 화면에서만(좁은 화면은 헤더를 두 줄로 유지). 제목 첫 글자에 맞춰 들여쓴다. */}
        {cycle?.goal && (
          <p
            className="hidden w-full truncate pl-[3.75rem] text-xs text-muted-foreground sm:block"
            title={cycle.goal}
            data-testid={`list-cycle-goal-${def.key}`}
          >
            {cycle.goal}
          </p>
        )}
      </div>

      {expanded && (
        <div id={bodyId} className="border-t" data-testid={`list-cycle-body-${def.key}`}>
          <SectionBody
            query={query}
            items={items}
            emptyText={emptyText}
            testKey={def.key}
            projectKey={projectKey}
            selected={selected}
            onToggleSelect={onToggleSelect}
            canDrag={canDrag}
          />
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          {query?.isFetchingNextPage && (
            <p className="px-3 py-2 text-xs text-muted-foreground">불러오는 중…</p>
          )}
        </div>
      )}
    </section>
  );
}

// 빈 구간 문구 — 필터가 걸려 비었으면 그 사실이 가장 정확하다. 필터 없이 사이클 행이 0인데 진행률엔 이슈가 있으면
// 하위 이슈만 있다는 뜻이라 알려 0행과 진행률의 모순을 풀어준다.
// 백로그 = 진행 중·예정 사이클 밖(완료 사이클에만 남은 이슈 포함) — 문구도 "사이클에 넣지 않은" 이 아니라 그 정의대로.
function sectionEmptyText(hasActiveFilters: boolean, isCycle: boolean, progressTotal: number): string {
  if (hasActiveFilters) return '조건에 맞는 이슈가 없습니다';
  if (!isCycle) return '진행 중·예정 사이클에 없는 미완료 이슈가 없습니다';
  if (progressTotal > 0) return `표시할 상위 작업이 없습니다 (하위 이슈 ${progressTotal}건 포함)`;
  return '이 사이클에 배정된 작업이 없습니다';
}

// 구간 본문 — 로딩 스켈레톤 / 오류(다시 시도) / 빈 문구 / 이슈 테이블.
function SectionBody({
  query,
  items,
  emptyText,
  testKey,
  projectKey,
  selected,
  onToggleSelect,
  canDrag,
}: {
  query: ReturnType<typeof useCycleSectionIssues>;
  items: IssueResponse[];
  emptyText: string;
  testKey: string;
  projectKey: string;
  selected: Set<number>;
  onToggleSelect: (number: number) => void;
  canDrag: boolean;
}) {
  if (!query || query.isLoading) {
    return (
      <table className="w-full" aria-busy="true" aria-label="이슈 불러오는 중">
        <tbody>
          <CycleSectionSkeletonRows />
        </tbody>
      </table>
    );
  }
  if (query.isError) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-sm" data-testid={`list-cycle-error-${testKey}`}>
        <span className="text-destructive">이슈를 불러오지 못했습니다.</span>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          다시 시도
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="px-3 py-3 text-sm text-muted-foreground" data-testid={`list-cycle-empty-${testKey}`}>
        {emptyText}
      </p>
    );
  }
  return (
    // table-fixed — 긴 제목이 표 폭을 밀어내지 않고 말줄임되며, 구간마다 컬럼 폭이 같아 정렬이 맞는다.
    <table className="w-full table-fixed text-sm">
      <CycleSectionColumnHead />
      <tbody className="[&>tr:last-child]:border-b-0">
        {items.map((it) => (
          <IssueRow
            key={it.id}
            issue={it}
            projectKey={projectKey}
            selected={selected.has(it.number)}
            onToggleSelect={onToggleSelect}
            canDrag={canDrag}
            // 한 이슈가 여러 사이클 구간에 동시에 보일 수 있어(M:N) 구간 키로 드래그 id 를 구분한다.
            dragScope={testKey}
          />
        ))}
      </tbody>
    </table>
  );
}
