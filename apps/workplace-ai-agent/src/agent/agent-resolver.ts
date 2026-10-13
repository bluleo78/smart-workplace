// 대행할 AGENT 1명 선택. payload.actingAgentId(WP-371, API 가 지정)가 있으면 그것을 우선하고,
// 없으면(구버전 API) envelope.assignees 의 첫 AGENT 로 폴백한다.
// AGENT 가 없는 이벤트 (HUMAN-only 이슈) 는 null → run-agent 가 spawn 생략.
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function pickActingAgentId(env: IssueEventEnvelope): number | null {
  if (env.payload.actingAgentId != null) return env.payload.actingAgentId;
  const agents = env.payload.assignees.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
