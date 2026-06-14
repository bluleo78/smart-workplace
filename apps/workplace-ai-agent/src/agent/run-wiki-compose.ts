// Wiki S3(A2): 위키 컴포즈 러너 — 비서 agentId 토큰 fetch → 빈 MCP config(도구 없음) → CLI 스트리밍 스폰 → 델타 콜백.
// run-home-compose.ts 미러. 단 (1) includePartialMessages:true 로 partial text_delta 를 받고,
// (2) MCP 도구 없음(순수 텍스트 생성), (3) runClaudeCliStream 으로 각 라인을 즉시 흘려 onDelta 발행.
// kill 전파: 상위(라우트)가 연결 종료 시 AbortSignal 을 abort → handle.kill() 로 child 종료.
import { writeEmptyMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliStream } from './cli-runner.js';
import { extractTextDelta } from './wiki-delta-parser.js';
import { thinkingDirective } from './thinking.js';
import { WIKI_SYSTEM_PROMPT, buildWikiUserMessage, type WikiComposeInput } from './wiki-prompt.js';
import type { RunAgentDeps } from './run-agent.js';

export async function runWikiCompose(
  input: WikiComposeInput,
  deps: RunAgentDeps,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 비서 AGENT 의 OAuth 토큰으로 LLM 인증. agentId 는 요청 본문에서 온다.
  const agentId = input.assistantAgentId;
  const token = (await deps.client.getOAuthToken(agentId)).token;
  // 도구 없음(순수 생성): 빈 mcpServers 임시 설정으로 allowedTools(mcp__workplace__*)를 0개로 해석시킨다.
  const mcpConfigPath = writeEmptyMcpConfig();

  try {
    // 생각의 깊이는 CLI 플래그가 없어 system-prompt 접미 지시문으로 근사한다.
    const systemPrompt = WIKI_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);
    const args = buildCliArgs({
      userMessage: buildWikiUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      mcpConfigPath,
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
    });
    const env = buildChildEnv(process.env, token, agentId);
    const handle = runClaudeCliStream(
      { args, env, timeoutMs: input.timeoutMs, logTag: `wiki-compose:${agentId}` },
      (line) => {
        try {
          const d = extractTextDelta(JSON.parse(line));
          if (d) onDelta(d);
        } catch {
          // 비JSON 라인 무시
        }
      },
    );
    // 상위 연결 종료 시 child 종료(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
    if (signal?.aborted) handle.kill();
    else signal?.addEventListener('abort', () => handle.kill(), { once: true });
    await handle.done;
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}
