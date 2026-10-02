// 5c-2 후속 (#33): envelope → runAgent fire-and-forget. client 는 외부에서 주입.
import { trackInflight } from '../graceful-shutdown.js';
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

export interface EventHandlerDeps {
  client: WorkplaceApiClient;
}

export function handleEvent(env: IssueEventEnvelope, deps: EventHandlerDeps): void {
  if (env.type === 'issue.commented' && env.payload.actor.kind === 'AGENT') {
    return;
  }
  // 종료 시 이 실행이 끝날 때까지 기다리도록 등록(WP-167)
  trackInflight(runAgent(env, deps)).catch((e) => {
    console.error('[event-handler] runAgent 실패', {
      type: env.type,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
