// MCP 디스패처(stdio workplace-mcp-server)가 모든 도구 호출을 기록하는 사이드카 헬퍼.
// WORKPLACE_TOOL_USE_LOG_PATH 미설정 시 no-op. (슬라이스 5 에서 workplace-mcp-server 와 함께 삭제.)
// ToolUseLine 단일 출처는 sdk-mcp-server.ts 로 이동했다(인-프로세스 어댑터가 emit).
import { appendFileSync } from 'node:fs';
import type { ToolUseLine } from './sdk-mcp-server.js';

export type { ToolUseLine };

// 사이드카에 한 줄 append. MCP 는 단일 stdio·순차 호출이라 append 경쟁 없음(#351 동일 전제).
export function appendToolUse(line: ToolUseLine): void {
  const p = process.env.WORKPLACE_TOOL_USE_LOG_PATH;
  if (!p) return; // env 없으면 비활성(no-op)
  try {
    appendFileSync(p, JSON.stringify(line) + '\n', 'utf8');
  } catch {
    // 로깅 실패가 본 흐름을 막지 않는다(표시용 부가기능).
  }
}
