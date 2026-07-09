// src/tools/index.ts — 사용자 컨텍스트 도구 집계. 에이전트 전용(propose_*, submit_response,
// unassign_self, show_*)은 정의하지 않는다 — 직접 실행 의미론만.
import type { PatApiClient } from '../clients/workplace-api.js';
import { buildCalendarTools } from './calendar.js';
import { buildDriveTools } from './drive.js';
import { buildIssueTools } from './issue.js';
import { buildMailTools } from './mail.js';
import { buildMessagingTools } from './messaging.js';
import type { McpTool } from './types.js';
import { buildWikiTools } from './wiki.js';

/** 사용자 PAT 컨텍스트에서 노출할 전체 도구 목록을 구성한다(이슈 10 + 위키/메시징/캘린더/드라이브/메일 16 = 총 26종). */
export function buildUserTools(client: PatApiClient): McpTool[] {
  return [
    ...buildIssueTools(client),
    ...buildWikiTools(client),
    ...buildMessagingTools(client),
    ...buildCalendarTools(client),
    ...buildDriveTools(client),
    ...buildMailTools(client),
  ];
}
