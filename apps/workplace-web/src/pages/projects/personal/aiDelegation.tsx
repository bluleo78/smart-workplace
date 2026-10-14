// 개인 체크리스트 행의 AI 배지(WP-377) — 진행 중 AI 작업이 있으면 AI 진행 배지, 없고 AI 담당이면 「AI 위임」.
// 예전 「AI 처리중」(AI 담당 + 이슈 진행 중) 문구는 없앴다 — 실제 진행 상태는 작업 기록(agentWork)이 보여 준다.
import { AgentStateBadge } from '@/components/ai/agentWork/AgentWorkBits';
import { AiSignalBadge } from '@/components/ai/AiSignalBadge';
import { displayState } from '@/lib/agentWork';
import type { AgentWorkState, IssueResponse } from '@/types/issue';

/** 행 배지 종류 — AI 진행 상태(시작 전 포함), AI 위임(작업 기록 없는 AI 담당), 또는 배지 없음(null). */
export type DelegationState = AgentWorkState | 'NOT_STARTED' | 'DELEGATED' | null;

// 대표 AI 진행 상태가 있으면 그것, 없고 담당자에 AGENT 가 있으면 DELEGATED, 그 외 null.
// eslint-disable-next-line react-refresh/only-export-components
export function delegationState(issue: Pick<IssueResponse, 'assignees' | 'status' | 'agentWork'>): DelegationState {
  const state = displayState(issue);
  if (state) return state;
  return issue.assignees.some((a) => a.kind === 'AGENT') ? 'DELEGATED' : null;
}

// 위임 배지 — 배지 없음이면 렌더하지 않음. testid 는 상태와 무관하게 같은 이름(ai-delegation-badge-{number})을 쓴다.
export function AiDelegationBadge({ issue }: { issue: Pick<IssueResponse, 'assignees' | 'status' | 'number' | 'agentWork'> }) {
  const state = delegationState(issue);
  const testId = `ai-delegation-badge-${issue.number}`;
  if (state === null) return null;
  if (state === 'DELEGATED') {
    return (
      <AiSignalBadge variant="info" data-testid={testId}>
        AI 위임
      </AiSignalBadge>
    );
  }
  return <AgentStateBadge state={state} data-testid={testId} />;
}
