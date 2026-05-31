import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useActivity } from '@/hooks/queries/useHomeQueries';

import { WidgetFrame } from './WidgetFrame';

/** 최근 활동. params.actorKind='AGENT' 면 AI 가 한 일만. */
export default function ActivityWidget({ params }: { params?: Record<string, unknown> }) {
  const actorKind = params?.actorKind as string | undefined;
  const { data, isLoading } = useActivity(actorKind);
  return (
    <WidgetFrame title={actorKind === 'AGENT' ? 'AI 활동' : '최근 활동'}>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="space-y-2" data-testid="activity-items">
          {data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              {a.actorKind === 'AGENT' && (
                <Badge className="bg-ai-accent text-ai-accent-foreground">AI</Badge>
              )}
              <span className="text-muted-foreground">{a.actorName}</span>
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
