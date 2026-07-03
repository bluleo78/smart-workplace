// 러너 중립 RunnerEvent 를 진행(progress) 신호로 분류한다.
// 텍스트 델타는 채팅방 UX에서 불필요하므로 무시하고, 도구 호출/완료/종료만 본다.
import type { RunnerEvent } from './runner-events.js';

export type ProgressSignal =
  | { kind: 'tool_use'; toolName: string }
  | { kind: 'tool_result' }
  | { kind: 'result' }
  | null;

// 'mcp__workplace__search_wiki' → 'search_wiki' 처럼 MCP 프리픽스를 벗긴다.
function stripMcpPrefix(name: string): string {
  const m = /^mcp__[^_]+__(.+)$/.exec(name);
  return m ? m[1] : name;
}

// RunnerEvent → 진행 신호. tool_use→도구명(프리픽스 제거), tool_done→결과, result→종료, 그 외 null.
export function fromRunnerEvent(e: RunnerEvent): ProgressSignal {
  if (e.type === 'tool_use') return { kind: 'tool_use', toolName: stripMcpPrefix(e.name) };
  if (e.type === 'tool_done') return { kind: 'tool_result' };
  if (e.type === 'result') return { kind: 'result' };
  return null;
}
