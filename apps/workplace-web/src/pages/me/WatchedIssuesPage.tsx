// 내 태스크 — 내가 watch 중인 이슈 목록. cursor 페이지네이션 + 무한 스크롤.

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { IssueTypeBadge } from '../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../components/labels/LabelChip';
import { useWatchedIssues } from '../../hooks/queries/useWatchedIssues';
import { IssuePriorityBadge } from '../projects/components/IssuePriorityBadge';
import { IssueStatusBadge } from '../projects/components/IssueStatusBadge';

export default function WatchedIssuesPage() {
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } = useWatchedIssues();
  const sentinel = useRef<HTMLDivElement | null>(null);

  // sentinel 진입 → 다음 페이지 자동 fetch.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting && hasNextPage && !isFetching) void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetching, fetchNextPage]);

  const items =
    data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">내 태스크</h1>
      {isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">구독 중인 태스크가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 w-32">ID</th>
                <th>제목</th>
                <th className="w-28">상태</th>
                <th className="w-24">우선순위</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className="border-b hover:bg-accent"
                  data-testid={`watched-row-${it.id}`}
                >
                  <td className="py-2 font-mono text-muted-foreground">
                    {it.projectKey}-{it.number}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {it.type && <IssueTypeBadge type={it.type} size="sm" />}
                      <Link
                        to={`/projects/${it.projectKey}/issues/${it.number}`}
                        className="hover:underline font-medium"
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
                    <IssueStatusBadge status={it.status} />
                  </td>
                  <td>
                    <IssuePriorityBadge priority={it.priority} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" className="h-1" />
      {isFetching && !isLoading && (
        <p className="text-muted-foreground py-2">불러오는 중…</p>
      )}
    </div>
  );
}
