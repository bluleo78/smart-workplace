import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
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
        // 빈 상태 — 아이콘+제목+설명+CTA로 사용자에게 맥락과 다음 행동을 안내한다.
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="issuelist-empty"
        >
          <ClipboardList className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">배정된 이슈가 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            나에게 할당된 이슈가 여기에 표시됩니다.
          </p>
          <Button variant="outline" size="sm" asChild className="mt-1">
            <Link to="/projects">프로젝트로 이동</Link>
          </Button>
        </div>
      )}
    </WidgetFrame>
  );
}
