// src/tools/index.ts — 사용자 PAT 컨텍스트 도구 집계.
// #846: 도구 정의(스키마·설명·핸들러)는 전부 공유 패키지에 있다 — ai-agent 와 같은 정의를 쓰므로 파라미터 이름이 어긋날 수 없다.
// 에이전트 전용(propose_*, submit_response, unassign_self, show_*)과 확인 카드가 필요한 쓰기는 노출하지 않는다 — 직접 실행 의미론만.
import { buildSharedTools, type SharedTool } from '@smart-workplace/mcp-tools-shared';
import type { PatApiClient } from '../clients/workplace-api.js';

/**
 * PAT 로 노출해도 되는 도구만 남긴다(#853).
 * PAT 에는 스코프가 없어 사용자 권한을 그대로 가지므로, 되돌릴 수 없는(destructive) 도구는 확인 카드 없이 실행되지 않도록 뺀다.
 * 그런 작업은 ai-agent 의 propose_* 확인 카드로만 한다.
 * 지금은 destructive 공유 도구가 없어 걸러지는 것이 없다 — 그런 도구가 공유 패키지에 들어와도 PAT 로 새지 않게 하는 방어선이다.
 */
export function exposableTools(tools: SharedTool[]): SharedTool[] {
  return tools.filter((t) => t.kind !== 'destructive');
}

/** 사용자 PAT 컨텍스트에서 노출할 도구 목록(공유 도구 중 destructive 제외). */
export function buildUserTools(client: PatApiClient): SharedTool[] {
  return exposableTools(buildSharedTools(client));
}
