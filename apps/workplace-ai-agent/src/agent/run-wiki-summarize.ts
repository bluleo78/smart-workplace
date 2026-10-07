// WP-301 노트 상단 요약 러너 — 비서 OAuth 토큰 → SDK 단발 실행 → 최종 텍스트.
// runDriveSummarize 와 같은 패턴(도구 미사용 텍스트 in/out).
import { runnerFor } from './agent-runner.js';
import { finalText } from './runner-events.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import { WIKI_SUMMARIZE_PROMPT } from './prompts/wiki.js';
import type { RunAgentDeps } from './run-agent.js';

export interface WikiSummarizeInput {
  title: string;
  body: string;
  assistantAgentId: number;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

/** 노트 제목·본문을 받아 3~5문장 요약을 돌려준다. 본문은 <note> 로 감싸 지시와 분리한다. */
export async function runWikiSummarize(
  i: WikiSummarizeInput,
  deps: RunAgentDeps,
): Promise<{ summary: string }> {
  const credential = await deps.client.getProviderCredential(i.assistantAgentId);
  const userMessage = `제목: ${i.title}\n\n<note>\n${i.body}\n</note>`;
  const events = await runnerFor(credential).collect({
    userMessage,
    systemPrompt: WIKI_SUMMARIZE_PROMPT,
    // 우선순위: 요청 body > redeem 응답 > env/기본값(runDriveSummarize 와 동일).
    model: i.model ?? credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL,
    maxTurns: i.maxTurns,
    credential,
    agentId: i.assistantAgentId,
    timeoutMs: i.timeoutMs,
    logTag: `wiki-summarize:${i.assistantAgentId}`,
    includePartialMessages: false,
  });
  return { summary: finalText(events).trim() };
}
