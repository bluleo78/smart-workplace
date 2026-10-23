import { Skeleton } from '@/components/ui/skeleton';
// 기존 이슈 단건 상세 훅 — 파일은 useIssue(단수). enabled 가드 내장.
import { useIssue } from '@/hooks/queries/useIssue';
// 상태·우선순위 한글 라벨 — 원시 enum(HIGHEST 등)이 화면에 그대로 나오지 않게 한다(WP-886).
import { priorityLabel, statusLabel } from '@/lib/issueGrouping';
import { showsLoadError } from '@/lib/queryFailure'

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

/** 단일 이슈 상세 요약. params: { number, projectKey }. */
export default function IssueDetailWidget({ params }: { params?: Record<string, unknown> }) {
  const projectKey = params?.projectKey as string | undefined;
  const number = params?.number != null ? Number(params.number) : undefined;
  if (!projectKey || !number) {
    return (
      <WidgetFrame title="이슈 상세">
        <p className="text-sm text-muted-foreground">표시할 이슈를 특정하지 못했어요.</p>
      </WidgetFrame>
    );
  }
  return <IssueDetailInner projectKey={projectKey} number={number} />;
}

// 훅 조건부 호출 회피 — projectKey/number 가 확정된 뒤에만 마운트되는 내부 컴포넌트.
function IssueDetailInner({ projectKey, number }: { projectKey: string; number: number }) {
  const query = useIssue(projectKey, number);
  const { data, isLoading, refetch } = query;
  return (
    <WidgetFrame title={`${projectKey}-${number}`}>
      {/* #465: fetch 실패 시 무한 스켈레톤 대신 재시도 가능한 에러 표시(다른 상세 위젯과 일관). */}
      {/* 다시 부르는 동안에도 실패 안내를 남긴다 — 다시 시도의 초점 유지(WP-881). */}
      {showsLoadError(query) ? (
        <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="issuedetail-error" />
      ) : isLoading || !data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-1" data-testid="issuedetail">
          <div className="text-sm font-medium">{data.summary.title}</div>
          <div className="text-xs text-muted-foreground">
            {statusLabel(data.summary.status, data.summary.statusName)} · {priorityLabel(data.summary.priority)}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
