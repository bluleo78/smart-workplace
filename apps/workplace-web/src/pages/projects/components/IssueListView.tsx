// 태스크 리스트 뷰 — cursor 기반 무한 스크롤.
// sentinel 이 뷰포트에 들어오면 다음 페이지를 자동 fetch.

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { LabelChip } from '../../../components/labels/LabelChip';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import type { IssueFilters } from '../../../types/issue';
import { IssuePriorityBadge } from './IssuePriorityBadge';
import { IssueStatusBadge } from './IssueStatusBadge';

export function IssueListView({
  projectKey,
  filters,
}: {
  projectKey: string;
  filters: IssueFilters;
}) {
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
    useIssueSearch(projectKey, filters);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver — sentinel 진입 시 다음 페이지 로드.
  // rootMargin 으로 화면 아래 200px 미리 트리거.
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

  // 응답 모양이 예상과 다르면(p.items 누락 등) flatMap 이 [undefined] 를 만들 수 있어 필터링.
  const items =
    data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [];
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        표시할 태스크가 없습니다.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" role="table">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 w-28">ID</th>
            <th>제목</th>
            <th className="w-28">상태</th>
            <th className="w-24">우선순위</th>
            <th className="w-32">마감</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.id}
              className="border-b hover:bg-accent"
              role="row"
              data-testid={`issue-row-${it.number}`}
            >
              <td className="py-2 font-mono text-muted-foreground">
                {projectKey}-{it.number}
              </td>
              <td>
                <Link
                  to={`/projects/${projectKey}/issues/${it.number}`}
                  className="font-medium hover:underline"
                >
                  {it.title}
                </Link>
                {it.labels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {it.labels.map((l) => (
                      <LabelChip key={l.id} label={l} size="sm" />
                    ))}
                  </div>
                )}
              </td>
              <td>
                <IssueStatusBadge status={it.status} />
              </td>
              <td>
                <IssuePriorityBadge priority={it.priority} />
              </td>
              <td>{it.dueDate ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      {isFetching && (
        <p className="text-muted-foreground py-2">불러오는 중…</p>
      )}
    </div>
  );
}
