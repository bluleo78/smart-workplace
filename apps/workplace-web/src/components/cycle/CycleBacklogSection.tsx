// 사이클 백로그 섹션 — Jira 백로그처럼 사이클(또는 사이클 미할당 백로그)별로 이슈를 묶어 보여준다 (#878).
// 섹션마다 독립 무한 스크롤 쿼리를 두고, 접힌 섹션은 요청하지 않는다(enabled=펼침).

import { ChevronRight } from 'lucide-react';
import { type ReactNode, useId, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon';
import { IssueTypeBadge } from '@/components/issueTypes/IssueTypeBadge';
import { UserAvatar } from '@/components/users/UserAvatar';
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
}) {
  const bodyId = useId();
  const count = showRowCount ? sectionCountLabel(query) : null;
  const hasMetaRow = !!(meta || progress || badge);
  return (
    <section
      data-testid={testId}
      data-active={active ? 'true' : undefined}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border bg-card',
        active && 'border-l-4 border-l-primary bg-primary/5',
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
          <SectionIssueList query={query} projectKey={projectKey} emptyText={emptyText} />
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
}: {
  query: BoardColumnQuery | undefined;
  projectKey: string;
  emptyText: string;
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
          <CycleIssueRow key={it.id} issue={it} projectKey={projectKey} />
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
function CycleIssueRow({ issue: it, projectKey }: { issue: IssueResponse; projectKey: string }) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;
  return (
    <li
      onClick={() => navigate(to)}
      className="flex min-w-0 cursor-pointer items-center gap-2.5 px-4 py-1.5 text-sm hover:bg-accent"
      data-testid={`section-issue-${it.number}`}
    >
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
      <Link
        to={to}
        onClick={(e) => e.stopPropagation()}
        className="min-w-[8rem] flex-1 truncate rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={it.title}
      >
        {it.title}
      </Link>
      <span className="flex shrink-0 items-center -space-x-1">
        {it.assignees.slice(0, 3).map((u) => (
          // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분(목록 행과 동일).
          <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
        ))}
        {it.assignees.length > 3 && (
          <span className="ml-1 text-xs text-muted-foreground">+{it.assignees.length - 3}</span>
        )}
      </span>
    </li>
  );
}
