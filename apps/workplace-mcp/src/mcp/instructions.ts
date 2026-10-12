// src/mcp/instructions.ts — MCP 서버 `instructions` 생성(WP-350).
// 클라이언트(Claude Code 의 tool search 등)는 이 문자열의 앞쪽 2,048자까지만 쓰므로, 앱별 도구 안내를 맨 앞에 두고 전체를 그 안에 맞춘다.
// 로드된 도구만 설명한다 — 앱을 좁히거나 읽기 전용으로 연결했을 때 없는 도구(생성·수정 등)를 안내하면 모델이 없는 도구를 부르려 한다.
import { TOOL_APP_GUIDES, TOOL_APPS, toolApps, type SharedTool } from '@smart-workplace/mcp-tools-shared';

import type { McpScope } from './scope.js';

/** 클라이언트가 instructions 에서 읽는 최대 길이 — 전체 앱 연결에서도 이 안에 들어와야 한다(테스트가 강제). */
export const INSTRUCTIONS_MAX_LENGTH = 2048;

/** 로드된 도구(tools)와 연결 범위(scope)로 instructions 문자열을 만든다. */
export function buildInstructions(tools: readonly SharedTool[], scope: McpScope): string {
  const loaded = new Set(tools.map((t) => t.name));
  const lines: string[] = [];

  // 앱별 안내 — 고른 앱(안 골랐으면 전체)이면서 로드된 도구가 있는 앱만, 앱 순서는 TOOL_APPS 기준.
  // 고르지 않은 앱은 여러 앱에 걸친 도구(read_attachment 등) 때문에 일부 도구가 실려도 설명하지 않는다 — 그 앱의 도구가 다 있는 것처럼 보이지 않게.
  for (const app of scope.apps ?? TOOL_APPS) {
    const inApp = tools.filter((t) => toolApps(t).includes(app));
    if (inApp.length === 0) continue;
    const guide = TOOL_APP_GUIDES[app];
    // 쓰기 문구는 이 앱의 쓰기 도구가 실제로 로드됐을 때만(읽기 전용 연결이면 빠진다).
    const hasWrite = guide.write !== '' && inApp.some((t) => t.kind !== 'read');
    const what = hasWrite ? `${guide.read} / ${guide.write}` : guide.read;
    const entry = guide.entry.filter((n) => loaded.has(n));
    lines.push(`- ${guide.label}: ${what}${entry.length > 0 ? ` (시작: ${entry.join(', ')})` : ''}`);
  }

  const mode = scope.readOnly ? '읽기 전용 연결입니다 — 조회 도구만 있고 생성·수정은 할 수 없습니다.' : '조회와 되돌릴 수 있는 쓰기를 제공합니다.';
  const range = scope.apps === null ? '전체 앱' : scope.apps.map((a) => TOOL_APP_GUIDES[a].label).join('·');
  const parts = [
    `Gen:iA Works 업무 도구입니다. 연결 범위: ${range}. ${mode}`,
    '앱별 안내:',
    ...lines,
    '이슈는 키(예: WP-12), 사람은 username 으로 가리킵니다. 삭제·메일 발송처럼 되돌릴 수 없는 작업은 제공하지 않습니다.',
  ];
  // 범위를 좁혔을 때만 넓히는 방법을 알린다 — 전체 연결에서는 군더더기다.
  if (scope.apps !== null || scope.readOnly) {
    parts.push('다른 앱이나 쓰기가 필요하면 연결 URL 을 바꾸세요: /mcp(전체), /mcp/x/issue,wiki(앱 선택), /mcp/readonly(읽기 전용).');
  }
  return parts.join('\n');
}
