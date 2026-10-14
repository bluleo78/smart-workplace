// src/tools/index.ts — 사용자 PAT 컨텍스트 도구 집계.
// #846: 도구 정의(스키마·설명·핸들러)는 전부 공유 패키지에 있다 — ai-agent 와 같은 정의를 쓰므로 파라미터 이름이 어긋날 수 없다.
// 에이전트 전용(propose_*, submit_response, unassign_self, show_*)과 되돌릴 수 없는(destructive) 쓰기는 노출하지 않는다 — 직접 실행 의미론만.
// AI Chat 이 확인 카드로 하는 되돌릴 수 있는 쓰기(예: create_event·update_event — WP-348, create_project·add_project_member·
// add_channel_member — WP-349)는 여기서 직접 실행 도구로 노출한다.
import { buildSharedTools, toolApps, type SharedTool } from '@smart-workplace/mcp-tools-shared';
import type { PatApiClient } from '../clients/workplace-api.js';
import { FULL_SCOPE, type McpScope } from '../mcp/scope.js';

/**
 * PAT 로 노출해도 되는 도구만 남긴다(#853).
 * PAT 에는 스코프가 없어 사용자 권한을 그대로 가지므로, 되돌릴 수 없는(destructive) 도구는 확인 카드 없이 실행되지 않도록 뺀다.
 * 그런 작업은 ai-agent 의 propose_* 확인 카드로만 한다.
 * 지금은 destructive 공유 도구가 없어 걸러지는 것이 없다 — 그런 도구가 공유 패키지에 들어와도 PAT 로 새지 않게 하는 방어선이다.
 */
export function exposableTools(tools: SharedTool[]): SharedTool[] {
  return tools.filter((t) => t.kind !== 'destructive');
}

/**
 * 연결 범위(WP-350)에 맞게 도구를 추린다 — 앱 선택이 있으면 그 앱에 속한 도구만, 읽기 전용이면 kind=read 만.
 * 여러 앱에 걸친 도구(toolApps)는 고른 앱 중 하나에만 속해도 남긴다. 기본 범위(FULL_SCOPE)는 입력을 그대로 돌려준다.
 */
export function selectTools(tools: SharedTool[], scope: McpScope): SharedTool[] {
  const { apps, readOnly } = scope;
  return tools.filter((t) => (apps === null || toolApps(t).some((a) => apps.includes(a))) && (!readOnly || t.kind === 'read'));
}

/**
 * 노출할 도구 목록(공유 도구 중 destructive 제외 → 연결 범위로 추림). 범위를 안 주면 전체.
 */
export function buildUserTools(client: PatApiClient, scope: McpScope = FULL_SCOPE): SharedTool[] {
  // WP-250: 외부 MCP 클라이언트 모델은 이미지를 볼 수 있다고 본다(pages 노출). 실행 단위가 없어 실행당 예산은 두지 않는다 — 호출당 3장만.
  return selectTools(exposableTools(buildSharedTools(client, { imageInput: true })), scope);
}
