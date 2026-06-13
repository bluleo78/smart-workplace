// 태스크 리스트 뷰 — cursor 기반 무한 스크롤.
// sentinel 이 뷰포트에 들어오면 다음 페이지를 자동 fetch.
// 행은 아이콘 중심(상태/우선순위/유형) + 담당자 + 행 전체 클릭으로 상세 이동(#234).

import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { formatDateKorean } from '../../../lib/formatters';
import { groupIssues } from '../../../lib/issueGrouping';
import type {
  IssueFilters,
  IssueGroupBy,
  IssueResponse,
} from '../../../types/issue';

export function IssueListView({
  projectKey,
  filters,
  groupBy,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueGroupBy | null;
}) {
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
    useIssueSearch(projectKey, filters);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver — sentinel 진입 시 다음 페이지 로드.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetching) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (isLoading) {
    return <p className="text-muted-foreground py-4">로딩 중…</p>;
  }

  const items =
    data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [];
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        표시할 태스크가 없습니다.
      </p>
    );
  }

  const groups = groupBy
    ? groupIssues(items, groupBy).filter((g) => g.issues.length > 0)
    : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" role="table">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            {/* 상태·우선순위는 아이콘 컬럼 — 헤더 라벨은 sr-only. */}
            <th className="w-9 py-2"><span className="sr-only">상태</span></th>
            <th className="w-9"><span className="sr-only">우선순위</span></th>
            <th className="w-28">ID</th>
            <th>제목</th>
            <th className="w-20">담당자</th>
            <th className="w-32">마감</th>
          </tr>
        </thead>
        {groups ? (
          groups.map((g) => (
            <tbody key={g.key} data-testid={`list-group-${g.key}`}>
              <tr className="bg-muted/40 border-b">
                <td
                  colSpan={6}
                  className="py-1.5 px-1 text-xs font-semibold text-muted-foreground"
                >
                  {g.label}
                  <span className="ml-2 font-normal">{g.issues.length}</span>
                </td>
              </tr>
              {g.issues.map((it) => (
                <IssueRow key={it.id} issue={it} projectKey={projectKey} />
              ))}
            </tbody>
          ))
        ) : (
          <tbody>
            {items.map((it) => (
              <IssueRow key={it.id} issue={it} projectKey={projectKey} />
            ))}
          </tbody>
        )}
      </table>
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      {isFetching && <p className="text-muted-foreground py-2">불러오는 중…</p>}
    </div>
  );
}

// 리스트 행 — 평탄/그룹 렌더가 공유 (DRY). 행 전체 클릭 → 상세(#234).
function IssueRow({
  issue: it,
  projectKey,
}: {
  issue: IssueResponse;
  projectKey: string;
}) {
  const navigate = useNavigate();
  const to = `/projects/${projectKey}/issues/${it.number}`;
  const isSubtask = it.type?.name === 'SUBTASK';

  return (
    <tr
      onClick={() => navigate(to)}
      className="border-b hover:bg-accent cursor-pointer"
      data-testid={`issue-row-${it.number}`}
    >
      <td className="py-2"><IssueStatusIcon status={it.status} /></td>
      <td><IssuePriorityBars priority={it.priority} /></td>
      <td className="font-mono text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          {it.type && <IssueTypeBadge type={it.type} size="sm" iconOnly />}
          <span>{projectKey}-{it.number}</span>
        </span>
      </td>
      <td>
        <div className="flex items-center gap-1.5 font-medium">
          {/* SUBTASK 면 부모 식별자(↳ KEY-N) 를 제목 앞에 작게 표시. */}
          {isSubtask && it.parent && (
            <span className="text-[11px] text-muted-foreground font-mono">
              ↳ {projectKey}-{it.parent.number}
            </span>
          )}
          {/* 제목 = 실제 링크(키보드 포커스·스크린리더 접근점). 행 onClick 은 마우스 편의용.
              stopPropagation 으로 링크 클릭이 행 onClick 까지 버블해 history 가 이중 push 되는 것을 막는다. */}
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {it.title}
          </Link>
        </div>
        {it.labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {it.labels.map((l) => (
              <LabelChip key={l.id} label={l} size="sm" />
            ))}
          </div>
        )}
      </td>
      <td>
        <span className="flex items-center -space-x-1">
          {it.assignees.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              {it.assignees.slice(0, 3).map((u) => (
                // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분.
                <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
              ))}
              {it.assignees.length > 3 && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  +{it.assignees.length - 3}
                </span>
              )}
            </>
          )}
        </span>
      </td>
      <td className="text-muted-foreground" data-testid={`issue-row-${it.number}-due`}>
        {formatDateKorean(it.dueDate)}
      </td>
    </tr>
  );
}
