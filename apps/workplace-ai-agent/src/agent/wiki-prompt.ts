// Wiki S3(A2): 인에디터 /ai 컴포즈 — 시스템 프롬프트 + 액션별 user 메시지 빌더.
// 도구를 쓰지 않는 순수 텍스트 생성이라 컨텍스트(본문/선택/지시문)는 모두 프롬프트에 임베드한다.

export type WikiAiAction = 'summarize' | 'draft' | 'continue';

export interface WikiComposeInput {
  // 비서 설정 — workplace-api 가 요청별로 해석해 전달(env 미사용).
  assistantAgentId: number;
  model: string;
  thinkingDepth: 'NONE' | 'NORMAL' | 'DEEP';
  maxTurns: number;
  timeoutMs: number;
  // 컴포즈 컨텍스트.
  action: WikiAiAction;
  pageTitle: string;
  pageBody: string; // 현재 본문(마크다운)
  selection?: string; // 선택 영역(요약 대상이 있을 때)
  prompt?: string; // draft 지시문
}

export const WIKI_SYSTEM_PROMPT =
  '너는 위키 문서 작성 보조자다. 마크다운으로만 답하고, 군더더기 설명·머리말 없이 본문에 바로 삽입될 텍스트만 출력한다. 도구를 사용하지 않는다.';

/** 액션별 사용자 메시지. 본문/선택/지시문을 컨텍스트로 조립한다. */
export function buildWikiUserMessage(i: WikiComposeInput): string {
  const ctx = i.selection?.trim() ? i.selection : i.pageBody;
  switch (i.action) {
    case 'summarize':
      return `다음 문서를 핵심만 간결히 요약해줘(마크다운 불릿).\n\n제목: ${i.pageTitle}\n\n${ctx}`;
    case 'continue':
      return `다음 문서의 마지막 부분을 자연스럽게 이어서 작성해줘. 이미 쓰인 내용은 반복하지 마.\n\n제목: ${i.pageTitle}\n\n${i.pageBody}`;
    case 'draft':
      return `다음 주제로 위키 문서 초안을 작성해줘: ${i.prompt ?? ''}\n\n(참고 제목: ${i.pageTitle})`;
  }
}
