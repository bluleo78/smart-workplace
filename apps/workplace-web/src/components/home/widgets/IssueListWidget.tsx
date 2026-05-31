import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useMyIssues } from '@/hooks/queries/useHomeQueries';
// 이슈 상태 전용 배지 — 범용 StatusBadge(type 기반)가 아니라 IssueStatus 를 직접 받는다.
import { IssueStatusBadge } from '@/pages/projects/components/IssueStatusBadge';

import { WidgetFrame } from './WidgetFrame';

/** params(assignee/status/priority/due 등)로 프로젝트 횡단 이슈 목록. */
export default function IssueListWidget({ params }: { params?: Record<string, unknown> }) {
  const { data, isLoading } = useMyIssues(params ?? { assignee: 'me' });
  return (
    <WidgetFrame title="이슈">
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y" data-testid="issuelist-items">
          {data.items.map((it) => (
            <li key={`${it.projectKey}-${it.number}`} className="py-2">
              <Link
                to={`/projects/${it.projectKey}/issues/${it.number}`}
                className="flex items-center justify-between gap-2 hover:text-ai-accent"
              >
                <span className="truncate text-sm">
                  <span className="text-muted-foreground">
                    {it.projectKey}-{it.number}
                  </span>{' '}
                  {it.title}
                </span>
                <IssueStatusBadge status={it.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="issuelist-empty">
          해당 조건의 이슈가 없어요.
        </p>
      )}
    </WidgetFrame>
  );
}
