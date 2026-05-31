import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries';
import type { IssueSearchResponse } from '@/types/issue';

import { WidgetFrame } from './WidgetFrame';

// size=50 페이지 기준 카운트 — hasMore 면 "N+" 로 표기(전체 카운트 엔드포인트 없음).
function count(data?: IssueSearchResponse): string {
  if (!data) return '–';
  return data.hasMore ? `${data.items.length}+` : String(data.items.length);
}

/** 내 할 일 요약 — 내 담당(IN_PROGRESS+TODO)·워치 카운트. params 무시(고정 요약). */
export default function MyTasksWidget() {
  const assigned = useMyIssues({ assignee: 'me', size: 50 });
  const watched = useWatchedIssues();
  const loading = assigned.isLoading || watched.isLoading;
  return (
    <WidgetFrame title="내 할 일">
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="flex gap-6">
          {/* 내 담당: 전역 "내 담당" 라우트가 아직 없어 카운트만 표기(링크 X). */}
          <div className="text-center" data-testid="mytasks-assigned">
            <div className="text-2xl font-semibold text-ai-accent">{count(assigned.data)}</div>
            <div className="text-xs text-muted-foreground">내 담당</div>
          </div>
          <Link to="/me/watched" className="text-center" data-testid="mytasks-watched">
            <div className="text-2xl font-semibold">{count(watched.data)}</div>
            <div className="text-xs text-muted-foreground">워치</div>
          </Link>
        </div>
      )}
    </WidgetFrame>
  );
}
