// 5c-2 후속 (#33): envelope → runAgent fire-and-forget. client 는 외부에서 주입.
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
  runAgent(env, deps).catch((e) => {
    console.error('[event-handler] runAgent 실패', {
      type: env.type,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
