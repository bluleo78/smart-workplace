// Wiki 컴포즈 러너 — #462: cli-runner → sdk-runner 전환. 비서 토큰 fetch → SDK 스트리밍 → 델타 콜백.
// MCP 도구 없음(순수 텍스트 생성) → mcpServer 미주입(allowedTools 의 mcp 와일드카드는 매칭 0이라 무해).
// (1) includePartialMessages:true 로 partial text_delta 수신, (2) 각 라인을 즉시 onDelta 로 흘림.
// kill 전파: 상위(라우트)가 연결 종료 시 AbortSignal → handle.kill() 로 query interrupt.
import { runSdkStream } from './sdk-runner.js';
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
  // 생각의 깊이는 전용 옵션이 없어 system-prompt 접미 지시문으로 근사한다.
  const systemPrompt = WIKI_SYSTEM_PROMPT + thinkingDirective(input.thinkingDepth);

  const handle = runSdkStream(
    {
      userMessage: buildWikiUserMessage(input),
      systemPrompt,
      model: input.model,
      maxTurns: input.maxTurns,
      token,
      agentId,
      timeoutMs: input.timeoutMs,
      logTag: `wiki-compose:${agentId}`,
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
    },
    (line) => {
      try {
        const d = extractTextDelta(JSON.parse(line));
        if (d) onDelta(d);
      } catch {
        // 비JSON 라인 무시
      }
    },
  );
  // 상위 연결 종료 시 query 중단(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
  if (signal?.aborted) handle.kill();
  else signal?.addEventListener('abort', () => handle.kill(), { once: true });
  await handle.done;
}
