import { Skeleton } from '@/components/ui/skeleton';
// 기존 이슈 단건 상세 훅 — 파일은 useIssue(단수). enabled 가드 내장.
import { useIssue } from '@/hooks/queries/useIssue';

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
  const { data, isLoading } = useIssue(projectKey, number);
  return (
    <WidgetFrame title={`${projectKey}-${number}`}>
      {isLoading || !data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-1" data-testid="issuedetail">
          <div className="text-sm font-medium">{data.summary.title}</div>
          <div className="text-xs text-muted-foreground">
            {data.summary.status} · {data.summary.priority}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
