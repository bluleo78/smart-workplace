// 5c-2 후속 (#33): envelope → runAgent fire-and-forget. client 는 외부에서 주입.
import { trackInflight } from '../graceful-shutdown.js';
import { runAgent } from './run-agent.js';
import { runRecurring } from './run-recurring.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { AiRunSink } from '../ai-run/types.js';

export interface EventHandlerDeps {
  client: WorkplaceApiClient;
  // WP-1828: AI 처리 기록을 받는 곳. events 라우터가 이벤트마다 범위를 열 때 쓴다(없으면 기록 안 함).
  aiRunSink?: AiRunSink;
}

/**
 * 이슈 이벤트 처리. WP-1828: 이 이벤트로 시작한 실행 promise 를 돌려준다(처리 안 하면 undefined).
 * 돌려주는 것은 trackInflight 로 등록되고 .catch 로그가 붙은 그 실행 promise 자체라,
 * 호출부가 무시해도 새 unhandled rejection 이 생기지 않고 observe(.then(ok, fail)) 하면 거부도 알 수 있다.
 */
export function handleEvent(env: IssueEventEnvelope, deps: EventHandlerDeps): Promise<unknown> | undefined {
  if (env.type === 'issue.commented' && env.payload.actor.kind === 'AGENT') {
    return undefined;
  }
  // WP-989: 반복 회차는 결과 내부 보고로 따로 돈다(결과 글은 API 가 대신 남긴다). WP-1313: 「지금 실행」(테스트 실행)도 같은 실행이고
  // 되돌릴 수 없는 쓰기만 멈춘다.
  const run =
    env.type === 'issue.recurring_run' || env.type === 'issue.recurring_test_run'
      ? runRecurring(env.payload, deps, { test: env.type === 'issue.recurring_test_run' })
      : runAgent(env, deps);
  // 종료 시 이 실행이 끝날 때까지 기다리도록 등록(WP-167)
  trackInflight(run).catch((e) => {
    console.error('[event-handler] runAgent 실패', {
      type: env.type,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
  return run;
}
