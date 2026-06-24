// AI 위임 상태 파생 + 배지. 담당자에 AGENT 가 있으면 위임으로 본다(IN_PROGRESS → 처리중).
import { AiSignalBadge } from '@/components/ai/AiSignalBadge';
import type { IssueResponse } from '@/types/issue';

export type DelegationState = 'none' | 'delegated' | 'in_progress';

// 이슈의 담당자/상태로 위임 상태를 계산한다.
// eslint-disable-next-line react-refresh/only-export-components
export function delegationState(issue: Pick<IssueResponse, 'assignees' | 'status'>): DelegationState {
  const hasAgent = issue.assignees.some((a) => a.kind === 'AGENT');
  if (!hasAgent) return 'none';
  return issue.status === 'IN_PROGRESS' ? 'in_progress' : 'delegated';
}

// 위임 배지 — none 이면 렌더하지 않음. AiSignalBadge info 변형으로 통일(상태 라벨을 children 으로).
export function AiDelegationBadge({ issue }: { issue: Pick<IssueResponse, 'assignees' | 'status' | 'number'> }) {
  const state = delegationState(issue);
  if (state === 'none') return null;
  const label = state === 'in_progress' ? 'AI 처리중' : 'AI 위임';
  return (
    <AiSignalBadge
      variant="info"
      data-testid={`ai-delegation-badge-${issue.number}`}
    >
      {label}
    </AiSignalBadge>
  );
}
