import { Activity } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useActivity } from '@/hooks/queries/useHomeQueries';
import { showsLoadError } from '@/lib/queryFailure'
import { historyEventPhrase } from '@/pages/projects/components/issueHistoryLabels';
import type { ActivityPage } from '@/types/home';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

/** 최근 활동. params.actorKind='AGENT' 면 AI 가 한 일만. */
export default function ActivityWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>;
  previewData?: ActivityPage;
}) {
  const actorKind = params?.actorKind as string | undefined;
  const query = useActivity(actorKind, { enabled: !previewData });
  const { data: queryData, isLoading, refetch } = query;
  const data = previewData ?? queryData;
  return (
    <WidgetFrame title={actorKind === 'AGENT' ? 'AI 활동' : '최근 활동'}>
      {/* fetch 실패 — 거짓 '빈 상태' 대신 에러+재시도 표시(#205). 로딩보다 먼저 봐 다시 부르는 동안에도 남긴다(WP-881). */}
      {!previewData && showsLoadError(query) ? (
        <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="activity-error" />
      ) : !previewData && isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="space-y-2" data-testid="activity-items">
          {data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              {a.actorKind === 'AGENT' && (
                <Badge className="bg-ai-accent text-ai-accent-foreground">AI</Badge>
              )}
              <span className="text-muted-foreground">{a.actorName}</span>
              {/* eventType → 한국어 문구. 프로젝트 개요 「최근 활동」과 같은 규칙(historyEventPhrase)이라 모르는 종류는 「수정」(WP-1593). */}
              <span className="text-xs text-muted-foreground">
                {historyEventPhrase(a.eventType)}
              </span>
              <Link
                to={`/projects/${a.projectKey}/issues/${a.issueNumber}`}
                className="truncate hover:text-ai-accent"
              >
                {a.issueTitle}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        // 빈 상태 — 아이콘+제목+설명 구조로 맥락 제공(DS §2.5). IssueListWidget 빈 상태와 시각 정합.
        // 명확한 단일 액션이 없어 CTA 는 생략(3요소).
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="activity-empty"
        >
          <Activity className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">최근 활동이 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            이슈가 생성·변경되면 여기에 표시됩니다.
          </p>
        </div>
      )}
    </WidgetFrame>
  );
}
