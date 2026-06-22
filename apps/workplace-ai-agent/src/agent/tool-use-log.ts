// MCP 디스패처가 모든 도구 호출(start/result)을 기록하는 사이드카 헬퍼.
// run-ai-compose 가 라이브 테일하므로 부모-자식(서브에이전트 포함) 도구가 한 파일에 모인다.
// WORKPLACE_TOOL_USE_LOG_PATH 미설정 시 no-op — 이슈/메시징 등 다른 경로엔 영향 없음.
import { appendFileSync } from 'node:fs';

// 사이드카 NDJSON 한 줄. tool-use-tailer 와 공유하는 단일 출처 타입.
export interface ToolUseLine {
  seq: number; // 디스패처가 호출마다 부여하는 단조 증가 번호(start/result 매칭용)
  event: 'tool_use_start' | 'tool_result';
  toolName: string;
  args?: Record<string, unknown>; // start 에만
  isError?: boolean; // result 에만
  result?: string; // result 에만(원본 문자열)
}

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
