// 5c-2: envelope → runAgent fire-and-forget. 5c-1 의 ack 텍스트 코드는 제거됨.
// AGENT actor 의 issue.commented 는 self-loop 방지를 위해 ai-agent 측에서도 skip.
// (업스트림인 5b-1 이 이미 skip 하지만 defense-in-depth.)
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function handleEvent(env: IssueEventEnvelope): void {
  if (env.type === 'issue.commented' && env.payload.actor.kind === 'AGENT') {
    return;
  }
  // fire-and-forget — /events 는 즉시 202 응답.
  runAgent(env).catch((e) => {
    console.error('[event-handler] runAgent 실패', {
      type: env.type,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
