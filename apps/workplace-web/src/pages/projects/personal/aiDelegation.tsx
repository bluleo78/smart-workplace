// AI 위임 상태 파생 + 배지. 담당자에 AGENT 가 있으면 위임으로 본다(IN_PROGRESS → 처리중).
import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

export type DelegationState = 'none' | 'delegated' | 'in_progress';

// 이슈의 담당자/상태로 위임 상태를 계산한다.
// eslint-disable-next-line react-refresh/only-export-components
export function delegationState(issue: Pick<IssueResponse, 'assignees' | 'status'>): DelegationState {
  const hasAgent = issue.assignees.some((a) => a.kind === 'AGENT');
  if (!hasAgent) return 'none';
  return issue.status === 'IN_PROGRESS' ? 'in_progress' : 'delegated';
}

// 위임 배지 — none 이면 렌더하지 않음.
export function AiDelegationBadge({ issue }: { issue: Pick<IssueResponse, 'assignees' | 'status' | 'number'> }) {
  const state = delegationState(issue);
  if (state === 'none') return null;
  const label = state === 'in_progress' ? '🤖 처리중' : '🤖 위임';
  return (
    <span
      data-testid={`ai-delegation-badge-${issue.number}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        'bg-ai-accent/15 text-ai-accent',
      )}
    >
      <Sparkles className="h-3 w-3" />
      {label}
    </span>
  );
}
