// CLI stream-json NDJSON 라인을 진행(progress) 신호로 분류한다.
// 텍스트 델타는 채팅방 UX에서 불필요하므로 무시하고, 도구 호출/결과/종료만 본다.
// (firehub agent-cli.ts 의 stream-json 분류를 진행표시용으로 축약)
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

export function parseProgressLine(line: string): ProgressSignal {
  let o: { type?: string; message?: { content?: Array<{ type?: string; name?: string }> } };
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o.type === 'assistant') {
    const tool = o.message?.content?.find((b) => b.type === 'tool_use');
    if (tool && typeof tool.name === 'string') {
      return { kind: 'tool_use', toolName: stripMcpPrefix(tool.name) };
    }
    return null; // 텍스트 전용 assistant 무시
  }
  if (o.type === 'user') {
    const hasResult = o.message?.content?.some((b) => b.type === 'tool_result');
    if (hasResult) return { kind: 'tool_result' };
    return null;
  }
  if (o.type === 'result') return { kind: 'result' };
  return null;
}
