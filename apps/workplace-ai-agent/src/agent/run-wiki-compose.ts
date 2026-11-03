// Wiki 컴포즈 러너 — #462: cli-runner → sdk-runner 전환. 비서 토큰 fetch → SDK 스트리밍 → 델타 콜백.
// MCP 도구 없음(순수 텍스트 생성) → mcpServer 미주입(allowedTools 의 mcp 와일드카드는 매칭 0이라 무해).
// (1) includePartialMessages:true 로 partial text_delta 수신, (2) 각 라인을 즉시 onDelta 로 흘림.
// kill 전파: 상위(라우트)가 연결 종료 시 AbortSignal → handle.kill() 로 query interrupt.
import { runnerFor } from './agent-runner.js';
import { withReadOnlyMemory } from './memory-block.js';
import { withSharedMemory } from './shared-memory-block.js';
import { extractTextDelta } from './wiki-delta-parser.js';
import { effortFor } from './thinking.js';
import { streamWithEffortFallback } from './effort-fallback.js';
import { buildWikiPrompt, type WikiComposeInput } from './wiki-prompt.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import type { RunAgentDeps } from './run-agent.js';

export async function runWikiCompose(
  input: WikiComposeInput,
  deps: RunAgentDeps,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 비서 AGENT 의 OAuth 토큰으로 LLM 인증. agentId 는 요청 본문에서 온다.
  const agentId = input.assistantAgentId;
  const credential = await deps.client.getProviderCredential(agentId);
  // 액션별 시스템 프롬프트·사용자 메시지는 buildWikiPrompt 가 함께 정한다(HTML 고치기 WP-1302 는 HTML 전용 프롬프트).
  // WP-1322: 생각의 깊이는 모델 추론 노력으로 싣는다 — Claude 는 SDK effort, opencode 는 variant(설정 안 함이면 미지정).
  const prompt = buildWikiPrompt(input);
  const systemPrompt = prompt.system;
  const effort = effortFor(input.thinkingDepth);

  // WP-1322: 고른 깊이(effort)를 이 Claude 모델이 받지 않아 거절되면 effort 없이 한 번 더 돈다(보인 것이 생기기 전에만).
  const handle = streamWithEffortFallback(
    runnerFor(credential),
    {
      // WP-381: 읽기 전용 메모리 블록을 요청문 맨 앞에(시스템 프롬프트는 그대로). WP-386: 그 뒤에 공용 블록.
      userMessage: withReadOnlyMemory(input.memories, withSharedMemory(input, prompt.user)),
      systemPrompt,
      // 우선순위: 요청 body(input.model) > redeem 응답(credential.model) > env/기본값.
      model: input.model ?? credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL,
      maxTurns: input.maxTurns,
      credential,
      agentId,
      timeoutMs: input.timeoutMs,
      logTag: `wiki-compose:${agentId}`,
      includePartialMessages: true, // partial text_delta 수신(스트리밍)
      thinkingEffort: effort,
    },
    (e) => {
      const d = extractTextDelta(e);
      if (d) onDelta(d);
    },
    { logArea: 'wiki-compose' },
  );
  // 상위 연결 종료 시 query 중단(자원 누수 방지). 이미 abort 된 신호면 즉시 kill.
  if (signal?.aborted) handle.kill();
  else signal?.addEventListener('abort', () => handle.kill(), { once: true });
  await handle.done;
}
