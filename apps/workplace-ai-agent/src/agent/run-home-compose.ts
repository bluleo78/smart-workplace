// 7b: 홈 컴포즈 러너 — 비서(assistant) agentId 토큰 fetch → home MCP config → CLI(home 프로필) 스폰 → 파서.
// 데이터 조회는 show_* 도구가 하지 않으므로 토큰은 순수 Claude LLM 인증용(데이터 권한과 무관).
// 모델/생각의 깊이/maxTurns/timeoutMs 는 workplace-api 가 비서 설정을 해석해 요청 본문으로 전달한다(#50).
import { HOME_SYSTEM_PROMPT } from './home-system-prompt.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliCollect, runClaudeCliStream } from './cli-runner.js';
import { parseComposeLines, type ComposeResult } from './compose-parser.js';
import { extractTextDelta } from './wiki-delta-parser.js';
import { thinkingDirective } from './thinking.js';
import type { RunAgentDeps } from './run-agent.js';

export interface ContextMessage {
  role: string; // 'USER' | 'ASSISTANT'
  content: string;
}
export interface ComposeInput {
  query: string;
  recentContext?: ContextMessage[];
  // 비서 설정 — workplace-api 가 요청별로 해석해 전달(env 미사용).
  assistantAgentId: number;
  model: string;
  thinkingDepth: 'NONE' | 'NORMAL' | 'DEEP';
  maxTurns: number;
  timeoutMs: number;
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

// SSE 라우트용 스트리밍 러너 — 토큰이 도착할 때마다 onText 콜백을 호출하고,
// 완료 후 parseComposeLines 로 최종 message + widgets 를 산출해 반환한다.
// signal abort 시 하위 CLI child 를 kill 해 자원 누수를 막는다(wiki 러너와 동일 패턴).
export async function runHomeComposeStream(
  input: ComposeInput,
  deps: RunAgentDeps,
  onText: (t: string) => void,
  signal: AbortSignal,
): Promise<{ fullText: string; widgets: unknown }> {
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'home',
  });

  try {
    const systemPrompt = HOME_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines: string[] = [];
    let fullText = '';
    const handle = runClaudeCliStream(
      { args, env, timeoutMs: input.timeoutMs, logTag: `home-compose:${agentId}` },
      (line) => {
        // 모든 라인을 누적(parseComposeLines 가 위젯/최종메시지 파싱에 사용).
        lines.push(line);
        try {
          // text_delta 만 추출해 스트리밍. 비JSON·thinking_delta 등은 무시.
          const delta = extractTextDelta(JSON.parse(line));
          if (delta) {
            fullText += delta;
            onText(delta);
          }
        } catch {
          // 비JSON 라인 무시
        }
      },
    );
    // 상위 연결 종료 시 child 종료(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
    if (signal.aborted) handle.kill();
    else signal.addEventListener('abort', () => handle.kill(), { once: true });
    await handle.done;
    // parseComposeLines 로 최종 message(result 이벤트) + widgets(tool_use 이벤트) 산출.
    const parsed = parseComposeLines(lines);
    return { fullText: parsed.message || fullText, widgets: parsed.widgets.length > 0 ? parsed.widgets : null };
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}

export async function runHomeCompose(
  input: ComposeInput,
  deps: RunAgentDeps,
): Promise<ComposeResult> {
  // 비서 AGENT 의 OAuth 토큰으로 LLM 인증. agentId 는 요청 본문에서 온다.
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'home',
  });

  try {
    // 생각의 깊이는 CLI 플래그가 없어 system-prompt 접미 지시문으로 근사한다.
    const systemPrompt = HOME_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      includePartialMessages: false,
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines = await runClaudeCliCollect({
      args,
      env,
      timeoutMs: input.timeoutMs,
      logTag: `home-compose:${agentId}`,
    });
    return parseComposeLines(lines);
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}
