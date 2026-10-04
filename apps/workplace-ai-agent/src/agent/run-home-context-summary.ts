// 메인 AI 채팅 누적 요약 러너(WP-232) — 토큰 예산을 넘친 앞부분 대화를 기존 요약에 합쳐 갱신된 요약 하나로 만든다.
// workplace-api HomeContextSummaryService 가 동기 호출. 도구 없이 텍스트 in/out — runText 가 비서 자격증명의
// provider 로 러너(Claude SDK / opencode)를 고르므로 두 러너 공통.
import { z } from 'zod';

import { type RunAgentDeps } from './run-agent.js';
import { runText } from './run-messaging-ai.js';
import { contextLabel } from './run-ai-chat.js';

export const homeContextSummaryInput = z.object({
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  // 직전까지의 누적 요약(첫 요약이면 null/생략).
  previousSummary: z.string().nullish(),
  // 이번에 요약에 합칠 구간(오래된 순).
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
});
export type HomeContextSummaryInput = z.infer<typeof homeContextSummaryInput>;

// 보존 우선순위를 명시 — 이후 턴에서 "처음에 뭐라 했지?" 류 질문과 승인 결과 재제안 방지(#843 규칙 7)에 필요한 것을 남긴다.
const SUMMARY_PROMPT =
  '당신은 업무 비서 대화의 기록 담당이다. "기존 요약"과 "새 대화 구간"을 합쳐, 이후 대화를 이어가는 데 필요한 내용을 ' +
  '하나의 갱신된 요약으로 한국어로 작성하라. 보존 우선순위: 1) 사용자의 목표·요청 2) 결정 사항·합의 3) 확정된 사실·수치 ' +
  '4) 식별자(이슈 키, 프로젝트, 사람 이름, 파일명, 날짜·시각) — 원문 그대로 5) [승인 결과] 줄의 승인/거절/실패와 사유 ' +
  '6) 아직 해결되지 않은 질문·할 일. 인사·잡담·중복 설명·AI 의 장황한 서술은 버린다. 추측해서 덧붙이지 않는다. ' +
  '불릿 목록으로 4000자 이내. 요약 본문만 출력한다(머리말·코드펜스 금지).';

// 요약 입력 메시지 — 채팅 프롬프트와 같은 라벨(사용자 / AI / [승인 결과])로 구간을 직렬화한다.
export function buildContextSummaryMessage(input: HomeContextSummaryInput): string {
  const prev = input.previousSummary?.trim() ? input.previousSummary : '(없음)';
  const lines = input.messages.map((m) => `${contextLabel(m)}: ${m.content}`).join('\n');
  return `기존 요약:\n${prev}\n\n새 대화 구간:\n${lines}`;
}

// 요약 실행 — 빈 결과는 실패로 본다(API 가 폴백 처리하도록 502 로 매핑되게 throw).
export async function runHomeContextSummary(
  input: HomeContextSummaryInput,
  deps: RunAgentDeps,
): Promise<{ summary: string }> {
  const { assistantAgentId, model, maxTurns, timeoutMs } = input;
  const text = await runText(
    SUMMARY_PROMPT,
    buildContextSummaryMessage(input),
    { assistantAgentId, model, maxTurns, timeoutMs },
    deps,
    'home-context-summary',
  );
  const summary = text.trim();
  if (!summary) throw new Error('빈 요약');
  return { summary };
}
