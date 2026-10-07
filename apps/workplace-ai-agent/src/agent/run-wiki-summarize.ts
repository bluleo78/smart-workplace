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

/**
 * 모델 출력을 카드 표시 형식(`• ` 목록, 빈 줄 없음)으로 맞춘다 — 프롬프트로 `• ` 를 요구해도 모델이 가끔
 * 마크다운 `- `·`* `·번호 목록이나 빈 줄을 섞어, 그대로 두면 메일 요약과 모양이 어긋나기 때문이다.
 * 목록 기호가 없는 줄은 손대지 않는다(모델이 목록을 안 따른 경우에도 내용은 잃지 않게).
 */
export function normalizeSummaryBullets(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^(?:[-*·•]|\d+[.)])\s+/, '• '))
    .join('\n');
}

/** 노트 제목·본문을 받아 핵심 3~5개 `• ` 목록 요약을 돌려준다. 본문은 <note> 로 감싸 지시와 분리한다. */
export async function runWikiSummarize(
  i: WikiSummarizeInput,
  deps: RunAgentDeps,
): Promise<{ summary: string }> {
  const userMessage = `제목: ${i.title}\n\n<note>\n${escapeNoteBody(i.body)}\n</note>`;
  // 모델 우선순위(요청 body > redeem 응답 > env/기본값)·로그 태그 형식은 runText 가 처리한다.
  const text = await runText(WIKI_SUMMARIZE_PROMPT, userMessage, i, deps, 'wiki-summarize');
  return { summary: normalizeSummaryBullets(text) };
}
