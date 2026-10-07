// WP-301 노트 상단 요약 러너 — 비서 OAuth 토큰 → SDK 단발 실행 → 최종 텍스트.
// 도구 미사용 텍스트 in/out 이라 공용 runText(run-mail-ai)를 그대로 쓴다(runDriveSummarize 와 같은 경로).
import { runText } from './run-mail-ai.js';
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

/**
 * 본문 안의 닫는 태그(`</note`, 대소문자 무관)를 `<\/note` 로 바꾼다 — 노트 내용이 <note> 경계를 닫고 그 뒤에 지시문을 끼워 넣는
 * 프롬프트 주입을 막기 위함이다. 사람이 읽는 의미는 그대로 남는다.
 */
export function escapeNoteBody(body: string): string {
  return body.replace(/<\/(note)/gi, '<\\/$1');
}

/** 노트 제목·본문을 받아 3~5문장 요약을 돌려준다. 본문은 <note> 로 감싸 지시와 분리한다. */
export async function runWikiSummarize(
  i: WikiSummarizeInput,
  deps: RunAgentDeps,
): Promise<{ summary: string }> {
  const userMessage = `제목: ${i.title}\n\n<note>\n${escapeNoteBody(i.body)}\n</note>`;
  // 모델 우선순위(요청 body > redeem 응답 > env/기본값)·로그 태그 형식은 runText 가 처리한다.
  const text = await runText(WIKI_SUMMARIZE_PROMPT, userMessage, i, deps, 'wiki-summarize');
  return { summary: text.trim() };
}
