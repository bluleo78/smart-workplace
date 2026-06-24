// 메시징 AI 러너 — 안읽은 일반 채널 메시지 배치에서 "암묵적으로 관련된 멤버"를 발굴한다.
// run-mail-ai.ts 의 runText 패턴 미러. 도구 없이 텍스트 in/out.
import { runSdkCollect } from './sdk-runner.js';
import { extractResultText } from './mail-parser.js';
import type { RunAgentDeps } from './run-agent.js';
import { z } from 'zod';

interface BaseConfig {
  assistantAgentId: number;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export const messagingClassifyInput = z.object({
  messages: z.array(z.object({ authorName: z.string(), body: z.string() })).min(1),
  members: z.array(z.object({ userId: z.number(), displayName: z.string() })).min(1),
});
export type MessagingClassifyInput = z.infer<typeof messagingClassifyInput> & BaseConfig;

// 메시징 분류 시스템 프롬프트 — @멘션 없이 이름·맥락으로 관련 멤버 발굴.
const MESSAGING_CLASSIFY_PROMPT =
  '당신은 팀 채팅 보조다. 아래 "최근 안읽은 메시지"에서, 명시적 @멘션은 없지만 ' +
  '암묵적으로 특정 멤버의 회신/확인이 필요한 경우를 찾아라. ' +
  '이름 언급, 담당 추정, 답을 기다리는 질문이 단서다. 단순 잡담·공지·인사는 제외. ' +
  '관련된 멤버만 JSON 으로: {"relevant":[{"userId":<id>,"reason":"<왜 한 문장>"}]}. 없으면 {"relevant":[]}.';

// 공통 텍스트 러너 — 토큰 fetch → SDK 단발 실행 → 최종 텍스트. run-mail-ai.ts 미러. 도구 미사용.
export async function runText(
  systemPrompt: string,
  userMessage: string,
  cfg: BaseConfig,
  deps: RunAgentDeps,
  tag: string,
): Promise<string> {
  const token = (await deps.client.getOAuthToken(cfg.assistantAgentId)).token;
  const lines = await runSdkCollect({
    userMessage,
    systemPrompt,
    model: cfg.model,
    maxTurns: cfg.maxTurns,
    token,
    agentId: cfg.assistantAgentId,
    timeoutMs: cfg.timeoutMs,
    logTag: `${tag}:${cfg.assistantAgentId}`,
    includePartialMessages: false,
  });
  return extractResultText(lines);
}

// relevant 배열 파싱 — 모델이 코드펜스/잡설을 섞어도 JSON 객체를 파싱. 실패 시 빈 배열 폴백.
// ⚠️ greedy(/\{[\s\S]*\}/)를 사용한다: 이 출력은 {"relevant":[{"userId":1,"reason":"..."}]} 처럼
//   배열 내 객체가 중첩되므로 non-greedy 는 첫 내부 } 에서 끊겨 JSON.parse 실패 → 항상 빈 결과가 된다.
//   mail 의 평면 JSON 과 달리 중첩 구조이므로 greedy 가 필수.
export function parseRelevantJson(text: string): { relevant: { userId: number; reason: string }[] } {
  // 코드펜스 제거 후 첫 '{' ~ 마지막 '}'  슬라이스 (greedy)
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    console.warn('[parseRelevantJson] JSON 객체를 찾지 못했습니다. text 앞부분:', text.slice(0, 120));
    return { relevant: [] };
  }
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1)) as { relevant?: unknown };
    const schema = z.object({
      relevant: z.array(z.object({ userId: z.number(), reason: z.string() })),
    });
    const parsed = schema.safeParse(obj);
    if (!parsed.success) {
      console.warn('[parseRelevantJson] zod 검증 실패:', parsed.error.message, '/ text 앞부분:', text.slice(0, 120));
      return { relevant: [] };
    }
    return parsed.data;
  } catch (e) {
    console.warn('[parseRelevantJson] JSON.parse 실패:', (e as Error).message, '/ text 앞부분:', text.slice(0, 120));
    return { relevant: [] };
  }
}

/**
 * 메시징 분류: 안읽은 채널 메시지 배치 → 암묵적 관련 멤버 목록.
 * run-mail-ai.runMailClassify 미러.
 */
export async function runMessagingClassify(
  input: MessagingClassifyInput,
  deps: RunAgentDeps,
): Promise<{ relevant: { userId: number; reason: string }[] }> {
  const memberList = input.members.map((m) => `${m.userId}=${m.displayName}`).join(', ');
  const messageList = input.messages.map((m) => `- ${m.authorName}: ${m.body}`).join('\n');
  const userMessage = `멤버: ${memberList}\n메시지:\n${messageList}`;
  return parseRelevantJson(await runText(MESSAGING_CLASSIFY_PROMPT, userMessage, input, deps, 'messaging-classify'));
}
