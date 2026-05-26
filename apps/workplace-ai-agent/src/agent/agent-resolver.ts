// envelope.assignees 에서 대행할 AGENT 1명 선택. 다중 AGENT 는 v1 비목표 — 첫 번째.
// AGENT 가 없는 이벤트 (HUMAN-only 이슈) 는 null → run-agent 가 spawn 생략.
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function pickActingAgentId(env: IssueEventEnvelope): number | null {
  const agents = env.payload.assignees.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
