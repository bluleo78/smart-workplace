import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useActivity } from '@/hooks/queries/useHomeQueries';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

/** eventType → 한국어 행동 레이블 매핑 */
const EVENT_LABEL: Record<string, string> = {
  CREATED: '생성',
  COMMENTED: '코멘트',
  STATUS_CHANGED: '상태 변경',
  STATUS_CHANGE: '상태 변경',
  // legacy 단일 assignee 시절 이벤트 — 과거 row 호환용(#200). 복수형 ASSIGNEES_CHANGED 와 동일 라벨.
  ASSIGNEE_CHANGED: '담당자 변경',
  ASSIGNEES_CHANGED: '담당자 변경',
  PRIORITY_CHANGED: '우선순위 변경',
  TITLE_CHANGED: '제목 변경',
  DESCRIPTION_CHANGED: '설명 변경',
  LABEL_CHANGED: '라벨 변경',
  LABELS_CHANGED: '라벨 변경',
  ATTACHMENTS_CHANGED: '첨부 변경',
  DUE_DATE_CHANGED: '마감일 변경',
  CLOSED: '완료',
  REOPENED: '재개',
  TYPE_CHANGED: '유형 변경',
  PARENT_CHANGED: '부모 변경',
  DEPENDENCY_ADDED: '의존성 추가',
  DEPENDENCY_REMOVED: '의존성 제거',
  CUSTOM_FIELD_CHANGED: '필드',
};

/** 최근 활동. params.actorKind='AGENT' 면 AI 가 한 일만. */
export default function ActivityWidget({ params }: { params?: Record<string, unknown> }) {
  const actorKind = params?.actorKind as string | undefined;
  const { data, isLoading, isError, refetch } = useActivity(actorKind);
  return (
    <WidgetFrame title={actorKind === 'AGENT' ? 'AI 활동' : '최근 활동'}>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        // fetch 실패 — 거짓 '빈 상태' 대신 에러+재시도 표시(#205).
        <WidgetError onRetry={() => refetch()} testId="activity-error" />
      ) : data && data.items.length > 0 ? (
        <ul className="space-y-2" data-testid="activity-items">
          {data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              {a.actorKind === 'AGENT' && (
                <Badge className="bg-ai-accent text-ai-accent-foreground">AI</Badge>
              )}
              <span className="text-muted-foreground">{a.actorName}</span>
              {/* eventType 을 한국어 레이블로 변환하여 행위 맥락 제공 */}
              <span className="text-xs text-muted-foreground">
                {EVENT_LABEL[a.eventType] ?? a.eventType}
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
        <p className="text-sm text-muted-foreground" data-testid="activity-empty">
          최근 활동이 없어요.
        </p>
      )}
    </WidgetFrame>
  );
}
