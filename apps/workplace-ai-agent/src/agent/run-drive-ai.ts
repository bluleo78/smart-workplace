// 드라이브 파일 요약 러너 — 비서 OAuth 토큰 fetch → SDK 단발 실행 → 텍스트 추출.
// 도구 미사용 텍스트 in/out. run-mail-ai 의 runText 패턴을 미러.
import { runSdkCollect } from './sdk-runner.js';
import { extractResultText } from './mail-parser.js';
import { DRIVE_SUMMARIZE_PROMPT } from './prompts/drive.js';
import type { RunAgentDeps } from './run-agent.js';

export interface DriveSummarizeInput {
  text: string;
  fileName: string;
  mime: string;
  assistantAgentId: number;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

// 파일 본문 요약: 파일명·MIME·본문 → {summary}.
// extractResultText 는 mail-parser 에서 export — 중복 없이 재사용.
export async function runDriveSummarize(
  i: DriveSummarizeInput,
  deps: RunAgentDeps,
): Promise<{ summary: string }> {
  // 비서 OAuth 토큰 취득 — 에이전트 자격으로 LLM 호출.
  const token = (await deps.client.getOAuthToken(i.assistantAgentId)).token;
  // 비신뢰 파일 본문을 userMessage 에 포함. 시스템 프롬프트에서 지시 무시 명시.
  const userMessage = `파일명: ${i.fileName}\n형식: ${i.mime}\n\n본문:\n${i.text}`;
  const lines = await runSdkCollect({
    userMessage,
    systemPrompt: DRIVE_SUMMARIZE_PROMPT,
    model: i.model,
    maxTurns: i.maxTurns,
    token,
    agentId: i.assistantAgentId,
    timeoutMs: i.timeoutMs,
    logTag: `drive-summarize:${i.assistantAgentId}`,
    includePartialMessages: false,
  });
  // mail-parser 의 extractResultText 를 직접 재사용해 최종 텍스트 추출.
  return { summary: extractResultText(lines).trim() };
}
