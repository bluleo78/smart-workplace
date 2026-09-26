// src/tools/index.ts — 사용자 PAT 컨텍스트 도구 집계.
// #846: 도구 정의(스키마·설명·핸들러)는 전부 공유 패키지에 있다 — ai-agent 와 같은 정의를 쓰므로 파라미터 이름이 어긋날 수 없다.
// 에이전트 전용(propose_*, submit_response, unassign_self, show_*)과 확인 카드가 필요한 쓰기는 노출하지 않는다 — 직접 실행 의미론만.
import { buildSharedTools, type McpTool } from '@smart-workplace/mcp-tools-shared';
import type { PatApiClient } from '../clients/workplace-api.js';

/** 사용자 PAT 컨텍스트에서 노출할 전체 도구 목록(공유 도구 전체). */
export function buildUserTools(client: PatApiClient): McpTool[] {
  return buildSharedTools(client);
}
