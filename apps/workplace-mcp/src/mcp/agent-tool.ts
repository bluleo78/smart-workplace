// src/mcp/agent-tool.ts — MCP 클라이언트의 User-Agent 에서 "수행 도구" 이름을 뽑는다 (WP-377).
// workplace-api 에 X-Agent-Tool 헤더로 실어 보내 AI 작업 보고의 출처(claude-code, cursor …)를 남기기 위함이다.

/** 허용 형식 — 소문자·숫자·하이픈 1~40자. 벗어나면 헤더 주입·임의 문자열을 막으려고 기본값으로 대체한다. */
const TOOL_NAME = /^[a-z0-9-]{1,40}$/;

/** 클라이언트를 알 수 없을 때의 기본 수행 도구 이름. */
const DEFAULT_AGENT_TOOL = 'mcp';

/**
 * User-Agent 의 첫 제품 토큰(`/` 또는 공백 앞)을 소문자로 돌려준다.
 * 배열이면 첫 값을 쓰고, 없거나 형식이 맞지 않으면 'mcp'.
 */
export function agentToolFromUserAgent(ua: string | string[] | undefined): string {
  const raw = Array.isArray(ua) ? ua[0] : ua;
  if (!raw) return DEFAULT_AGENT_TOOL;
  const token = raw.trim().split(/[\s/]/, 1)[0].toLowerCase();
  return TOOL_NAME.test(token) ? token : DEFAULT_AGENT_TOOL;
}
