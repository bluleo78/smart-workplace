// 대행할 AGENT 는 API 가 정해 payload.actingAgentId 로 보낸다(WP-371). ai-agent 는 직접 고르지 않는다 —
// assignees 에서 첫 AGENT 를 추정하면 외부 실행 에이전트를 서버가 대신 돌릴 위험이 있어 폴백을 두지 않는다.
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function pickActingAgentId(env: IssueEventEnvelope): number {
  return env.payload.actingAgentId;
}
