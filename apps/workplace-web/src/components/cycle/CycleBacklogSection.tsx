// 사이클 백로그 섹션 — Jira 백로그처럼 사이클(또는 사이클 미할당 백로그)별로 이슈를 묶어 보여준다 (#878).
// 섹션마다 독립 무한 스크롤 쿼리를 두고, 접힌 섹션은 요청하지 않는다(enabled=펼침).
// 드래그 앤 드롭(#881): 섹션 전체(헤더 포함, 접혀도)가 드롭 대상, 이슈 행 전체가 드래그 소스. DndContext 는 페이지가 둔다.

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useCallback, useId, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon';
import { IssueTypeBadge } from '@/components/issueTypes/IssueTypeBadge';
import { UserAvatar } from '@/components/users/UserAvatar';
import type { SectionCycleId } from '@/hooks/queries/useCycleSectionIssues';
import type { BoardColumnQuery } from '@/hooks/queries/useIssueBoardColumns';
import { useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

// 헤더 건수 — 백로그 전용(사이클은 progress 가 전체 기준 숫자를 맡아 행 수와 병기하지 않는다).
// 행과 같은 소스(로드된 항목 수)이고, 다음 페이지가 남았으면 "+" 로 하한임을 알린다.
function sectionCountLabel(query: BoardColumnQuery | undefined): string | null {
  if (!query?.data) return null;
  const n = query.data.pages.reduce((acc, p) => acc + (p.items?.length ?? 0), 0);
  return `${n}${query.hasNextPage ? '+' : ''}건`;
}

/** 드래그 소스(이슈 행) 데이터 — 드롭 시 이동 요청의 from 이 된다. 섹션 이름·상태는 페이지가 사이클 목록에서 찾는다. */
export interface CycleDragData {
  issue: IssueResponse;
  fromCycleId: SectionCycleId;
}

/** 드롭 대상(섹션) 데이터. */
export interface CycleDropData {
  cycleId: SectionCycleId;
}

/** 드롭 대상 id — 섹션 식별자와 1:1. */
function sectionDropId(cycleId: SectionCycleId): string {
  return cycleId == null ? 'section-backlog' : `section-cycle-${cycleId}`;
}

/**
 * 섹션 껍데기 — 헤더(펼침 토글·이름·배지 / 메타·진행률 / 목표) + 펼친 경우 본문.
 * 토글 버튼과 편집·삭제 액션은 형제로 둔다 — 버튼 중첩은 무효 마크업이고, 액션 클릭이 펼침까지 토글하면 안 된다.
 * 좁은 화면(<sm)에선 배지를 메타 행으로 내리고, 액션은 호출처가 준 mobileActions(⋯ 메뉴)로 바꿔 이름 폭을 확보한다.
 */
export function CycleSectionShell({
  testId,
  toggleTestId,
  active = false,
  expanded,
  onToggle,
  title,
  badge,
  meta,
  progress,
  actions,
  mobileActions,
  goal,
  showRowCount = false,
  emptyText,
  query,
  projectKey,
  cycleId,
  dropDisabled = false,
  canDrag = false,
}: {
  testId: string;
  toggleTestId: string;
  /** 진행 중 사이클 강조(좌측 primary 바 + 옅은 틴트). */
  active?: boolean;
  expanded: boolean;
  onToggle: () => void;
  title: string;
  badge?: ReactNode;
  meta?: ReactNode;
  progress?: ReactNode;
  /** sm 이상에서 보이는 액션(아이콘 버튼들). */
  actions?: ReactNode;
  /** sm 미만에서 보이는 액션(⋯ 드롭다운). */
  mobileActions?: ReactNode;
  goal?: string | null;
  /** 헤더에 행 수("N건") 표시 — progress 가 없는 백로그만 켠다. */
  showRowCount?: boolean;
  /** 행이 0개일 때 본문 안내 문구. */
  emptyText: string;
  query: BoardColumnQuery | undefined;
  projectKey: string;
  /** 이 섹션이 나타내는 사이클(null=백로그) — 드롭 대상 식별·행 드래그 출발지. */
  cycleId: SectionCycleId;
  /** 드롭 불가(완료 사이클) — 드래그 중 흐리게 + 안내. 행을 끌어내는 것은 허용. */
  dropDisabled?: boolean;
  /** 행 드래그 허용(프로젝트 멤버만). */
  canDrag?: boolean;
}) {
  const bodyId = useId();
  const count = showRowCount ? sectionCountLabel(query) : null;
  const hasMetaRow = !!(meta || progress || badge);
  const { setNodeRef, isOver, active: dragging } = useDroppable({
    id: sectionDropId(cycleId),
    data: { cycleId } satisfies CycleDropData,
    disabled: dropDisabled,
  });
  // 드롭 하이라이트 — 출발 섹션 자신 위에서는 표시하지 않는다(놓아도 변화 없음).
  const fromHere = (dragging?.data.current as CycleDragData | undefined)?.fromCycleId === cycleId;
  const dropTarget = isOver && !fromHere;
  const blocked = !!dragging && dropDisabled;
  return (
    <section
      ref={setNodeRef}
      data-testid={testId}
      data-active={active ? 'true' : undefined}
      data-drop-target={dropTarget ? 'true' : undefined}
      data-drop-blocked={blocked ? 'true' : undefined}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border bg-card transition-colors',
        active && 'border-l-4 border-l-primary bg-primary/5',
        dropTarget && 'bg-primary/10 ring-2 ring-primary ring-inset',
        blocked && 'opacity-50',
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-2 px-3 pt-2.5', !hasMetaRow && !goal && 'pb-2.5')}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          data-testid={toggleTestId}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-90')}
            aria-hidden="true"
          />
          {/* 이름 폭 확보 — 형제(배지·건수)는 shrink-0 이지만 <sm 에선 배지가 메타 행으로 내려가 이름이 남은 폭을 모두 쓴다.
              고정 min-w 는 짧은 이름 뒤에 빈 간격을 만들어(min-width 는 내용보다 넓게 잡힘) 쓰지 않는다. */}
          <span className="min-w-0 truncate font-medium" title={title}>
            {title}
          </span>
          {badge && <span className="hidden shrink-0 sm:inline-flex">{badge}</span>}
          {count && (
            <span
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              data-testid={`${testId}-count`}
            >
              {count}
            </span>
          )}
        </button>
        {dropTarget && (
          <span className="shrink-0 text-xs font-medium text-primary" data-testid={`${testId}-drop-hint`}>
            여기에 놓아 이동
          </span>
        )}
        {blocked && (
          <span className="shrink-0 text-xs text-destructive" data-testid={`${testId}-drop-blocked`}>
            완료된 사이클에는 놓을 수 없음
          </span>
        )}
        {actions && <div className="hidden shrink-0 gap-1 sm:flex">{actions}</div>}
        {mobileActions && <div className="shrink-0 sm:hidden">{mobileActions}</div>}
      </div>
      {hasMetaRow && (
        <div
          className={cn(
            'flex min-w-0 flex-col gap-1.5 pl-9 pr-3 pt-1 sm:flex-row sm:items-start sm:gap-3',
            !goal && 'pb-2.5',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {badge && <span className="inline-flex sm:hidden">{badge}</span>}
            {meta}
          </div>
          {/* CycleProgressBar 는 w-full 이라 폭을 고정한 상자에 담아야 flex 안에서 0폭으로 줄지 않는다.
              좁은 화면에선 메타 아래 줄로 내려 전체 폭을 쓴다. */}
          {progress && <div className="w-full shrink-0 sm:w-36">{progress}</div>}
        </div>
      )}
      {goal && (
        <p className="truncate pb-2.5 pl-9 pr-3 pt-1 text-sm text-muted-foreground" title={goal}>
          {goal}
        </p>
      )}
      {expanded && (
        <div id={bodyId} className="border-t bg-muted/30">
          <SectionIssueList
            query={query}
            projectKey={projectKey}
            emptyText={emptyText}
            dragFrom={canDrag ? cycleId : undefined}
          />
        </div>
      )}
    </section>
  );
}

// 비활성 섹션용 자리표시 — 훅 규칙상 sentinel 훅은 항상 호출되므로 아무 일도 하지 않는 fetch 를 준다.
const noopFetch = () => Promise.resolve() as never;

// 섹션 본문 — 이슈 행 목록 + 섹션 끝 sentinel(다음 페이지). 빈 섹션은 안내 문구.
function SectionIssueList({
  query,
  projectKey,
  emptyText,
  dragFrom,
}: {
  query: BoardColumnQuery | undefined;
  projectKey: string;
  emptyText: string;
  /** 드래그 허용 시 출발 섹션(사이클 id, null=백로그). undefined 면 행 드래그 비활성. */
  dragFrom?: SectionCycleId;
}) {
  const sentinelRef = useLoadMoreSentinel(
    query ?? { hasNextPage: false, isFetching: false, isFetchNextPageError: false, fetchNextPage: noopFetch },
  );
  const items = useMemo(
    () => query?.data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [],
    [query?.data],
  );

  if (!query || query.isLoading) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">로딩 중…</p>;
  }
  if (query.isError) {
    return <p className="px-4 py-3 text-sm text-destructive">이슈를 불러오지 못했습니다.</p>;
  }
  if (items.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="section-empty">
        {emptyText}
      </p>
    );
  }
  return (
    <div>
      <ul className="divide-y">
        {items.map((it) => (
          <CycleIssueRow key={it.id} issue={it} projectKey={projectKey} dragFrom={dragFrom} />
        ))}
      </ul>
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      {query.isFetchingNextPage && (
        <p className="px-4 py-2 text-xs text-muted-foreground">불러오는 중…</p>
      )}
    </div>
  );
}

// 이슈 행 — 이슈 목록(IssueListView)의 행과 같은 시각 언어(상태·우선순위 아이콘, 키, 제목, 담당자)를 컴팩트하게.
// 행 클릭 → 상세 이동, 제목은 실제 링크(키보드 접근점). 링크 클릭이 행 onClick 으로 버블해 이중 push 되지 않게 막는다.
// 행 전체가 드래그 소스(#881) — PointerSensor 임계값(5px) 미만의 짧은 클릭은 그대로 상세 이동으로 남는다.
function CycleIssueRow({
  issue: it,
  projectKey,
  dragFrom,
}: {
  issue: IssueResponse;
  projectKey: string;
  dragFrom?: SectionCycleId;
}) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;
  const canDrag = dragFrom !== undefined;
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    // 같은 이슈가 여러 사이클 섹션에 동시에 보일 수 있어 출발 섹션까지 id 에 넣는다.
    id: `issue-${it.id}-from-${dragFrom ?? 'backlog'}`,
    data: canDrag ? ({ issue: it, fromCycleId: dragFrom } satisfies CycleDragData) : undefined,
    disabled: !canDrag,
  });
  // 활성화 노드=행 자신 — 지정하지 않으면 KeyboardSensor 가 제목 링크 등 자손의 키 입력까지 받아 드래그를 시작한다.
  const ref = useCallback(
    (el: HTMLLIElement | null) => {
      setNodeRef(el);
      setActivatorNodeRef(el);
    },
    [setNodeRef, setActivatorNodeRef],
  );
  // 드래그 비활성이면 dnd-kit 의 role=button·tabIndex·리스너를 붙이지 않는다(평범한 목록 행).
  const dragProps = canDrag
    ? { ...attributes, ...listeners, 'aria-roledescription': '드래그 가능한 이슈' }
    : {};
  return (
    <li
      ref={ref}
      {...dragProps}
      onClick={() => navigate(to)}
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-2.5 px-4 py-1.5 text-sm hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        isDragging && 'opacity-40',
      )}
      data-testid={`section-issue-${it.number}`}
    >
      <IssueRowContent issue={it} projectKey={projectKey} to={to} />
    </li>
  );
}

/** 드래그 오버레이 — 포인터를 따라가는 행 사본(링크·클릭 없이 모양만). */
export function CycleIssueDragPreview({ issue, projectKey }: { issue: IssueResponse; projectKey: string }) {
  return (
    <div
      // 폭 상한 — dnd-kit 은 오버레이를 원본 행 폭(섹션 전체)으로 잡아, 그대로면 대상 섹션 헤더의 안내 문구·액션을 덮는다.
      className="flex w-fit max-w-[min(28rem,calc(100vw-2rem))] min-w-0 cursor-grabbing items-center gap-2.5 rounded-md border bg-card px-4 py-1.5 text-sm shadow-lg"
      data-testid="cycle-drag-overlay"
    >
      <IssueRowContent issue={issue} projectKey={projectKey} />
    </div>
  );
}

// 행 본문 — 목록 행과 드래그 오버레이가 공유. to 가 있으면 제목을 링크로, 없으면 텍스트로.
// memo — 드래그 중 dnd-kit 컨텍스트 변화로 행 래퍼가 다시 렌더돼도 본문(아이콘·아바타)은 건너뛴다.
const IssueRowContent = memo(function IssueRowContent({
  issue: it,
  projectKey,
  to,
}: {
  issue: IssueResponse;
  projectKey: string;
  to?: string;
}) {
  return (
    <>
      <IssueStatusIcon status={it.status} />
      {/* 좁은 화면(<sm)에선 우선순위·유형을 숨겨 제목 폭을 확보한다(상태·키·담당자만). */}
      <span className="hidden shrink-0 sm:inline-flex">
        <IssuePriorityBars priority={it.priority} />
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground sm:w-20">
        {it.type && (
          <span className="hidden sm:inline-flex">
            <IssueTypeBadge type={it.type} size="sm" iconOnly />
          </span>
        )}
        <span className="truncate">
          {projectKey}-{it.number}
        </span>
      </span>
      {to ? (
        <Link
          to={to}
          onClick={(e) => e.stopPropagation()}
          className="min-w-[8rem] flex-1 truncate rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={it.title}
        >
          {it.title}
        </Link>
      ) : (
        <span className="min-w-[8rem] flex-1 truncate font-medium">{it.title}</span>
      )}
      <span className="flex shrink-0 items-center -space-x-1">
        {it.assignees.slice(0, 3).map((u) => (
          // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분(목록 행과 동일).
          <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
        ))}
        {it.assignees.length > 3 && (
          <span className="ml-1 text-xs text-muted-foreground">+{it.assignees.length - 3}</span>
        )}
      </span>
    </>
  );
});
