// Wiki S3(A2): 인에디터 /ai 컴포즈 — 시스템 프롬프트 + 액션별 user 메시지 빌더.
// 도구를 쓰지 않는 순수 텍스트 생성이라 컨텍스트(본문/선택/지시문)는 모두 프롬프트에 임베드한다.
import type { MemoryItem } from './memory-block.js';
import type { SharedMemoryInput } from './shared-memory-block.js';

export type WikiAiAction =
  | 'draft'
  | 'continue'
  | 'rewrite_tone'
  | 'translate'
  | 'expand'
  | 'condense'
  | 'polish'
  | 'fix_html';

export interface WikiComposeInput extends SharedMemoryInput {
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
  selection?: string; // 선택 영역(변형 대상이 있을 때)
  prompt?: string; // draft 지시문 · fix_html 고칠 지시
  targets?: string[]; // WP-1302 fix_html — 고른 요소 설명(있으면 그 부분만 고친다)
  memories?: MemoryItem[]; // WP-381 읽기 전용 메모리
}

export const WIKI_SYSTEM_PROMPT =
  '너는 노트 문서 작성 보조자다. 마크다운으로만 답하고, 군더더기 설명·머리말 없이 본문에 바로 삽입될 텍스트만 출력한다. 도구를 사용하지 않는다.';

/**
 * WP-1302 HTML 블록 고치기 시스템 프롬프트 — 노트 문서용(마크다운으로 답하라) 지시와 충돌하지 않게 따로 둔다.
 * 답은 웹이 그대로 블록 소스로 바꿔 넣으므로(미리보기 뒤 「적용」) 설명·코드 울타리 없이 HTML 전체만 받는다.
 */
export const WIKI_FIX_HTML_SYSTEM_PROMPT =
  '너는 HTML 문서를 고치는 보조자다. 고친 HTML 소스 전체만 출력한다 — 설명·머리말·맺음말·코드 울타리(```) 없이, 첫 글자부터 마지막 글자까지 그대로 저장될 소스다. 도구를 사용하지 않는다.';

/**
 * fix_html 사용자 메시지(WP-1302).
 * - 고른 요소(targets)가 있으면 그 요소만 고치고 나머지는 한 글자도 바꾸지 않게 한다 — 사용자가 짚은 곳 밖이 달라지면 「바뀐 코드」 비교가 어지럽고
 *   의도하지 않은 변경이 섞인다. 없으면 블록 전체가 대상이다.
 * - 스크립트(차트 등)가 계속 돌게 하고, 원래 소스가 쓰지 않던 바깥 자원(CDN·이미지 주소)은 새로 넣지 않게 한다 — 블록은 격리 iframe 에서 돌고
 *   새 바깥 주소는 사용자가 확인하지 않은 외부 요청이 된다.
 * - 노트 본문(pageBody)은 싣지 않는다 — 고칠 대상은 블록 소스뿐이라 토큰만 늘린다.
 */
function buildFixHtmlMessage(i: WikiComposeInput): string {
  const targets = i.targets?.filter((t) => t.trim()) ?? [];
  const scope = targets.length
    ? `고칠 대상은 아래 「고른 요소」뿐이다. 그 요소(와 그 안)만 고치고, 나머지 소스는 공백·줄바꿈까지 한 글자도 바꾸지 마.\n\n고른 요소:\n${targets
        .map((t, n) => `${n + 1}. ${t}`)
        .join('\n')}`
    : '고칠 대상은 HTML 전체다. 요청과 관계없는 부분은 그대로 둬.';
  return [
    `다음 HTML 소스를 요청대로 고쳐줘.`,
    `요청: ${i.prompt ?? ''}`,
    scope,
    '지킬 것:\n- 고친 HTML 소스 전체만 출력해(설명·코드 울타리 없이).\n- 기존 스크립트(차트 등)가 그대로 동작하게 해.\n- 원래 소스가 쓰지 않던 바깥 자원(CDN 스크립트·스타일·이미지 주소)은 새로 넣지 마.',
    `(참고: 노트 제목 「${i.pageTitle}」)`,
    `HTML 소스:\n${i.selection ?? ''}`,
  ].join('\n\n');
}

/** 한 액션의 프롬프트 — 시스템 프롬프트와 사용자 메시지. */
export interface WikiPrompt {
  system: string;
  user: string;
}

/** 노트 문서 작성 보조자 프롬프트(마크다운 답) — fix_html 을 뺀 모든 액션이 쓴다. */
const notePrompt = (user: string): WikiPrompt => ({ system: WIKI_SYSTEM_PROMPT, user });

/**
 * 액션별 프롬프트 — 시스템 프롬프트와 사용자 메시지를 한곳(switch 한 번)에서 정한다. 본문/선택/지시문을 컨텍스트로 조립한다.
 * 실행 쪽(runWikiCompose)이 액션 이름으로 따로 가르지 않게 둘을 함께 돌려준다(WP-1302 — fix_html 은 HTML 전용 시스템 프롬프트).
 */
export function buildWikiPrompt(i: WikiComposeInput): WikiPrompt {
  const ctx = i.selection?.trim() ? i.selection : i.pageBody;
  switch (i.action) {
    case 'continue':
      return notePrompt(
        `다음 문서의 마지막 부분을 자연스럽게 이어서 작성해줘. 이미 쓰인 내용은 반복하지 마.\n\n제목: ${i.pageTitle}\n\n${i.pageBody}`,
      );
    case 'draft':
      // 페이지 제목은 본문 밖 입력란에 따로 표시되므로, 본문 첫 줄에 H1 으로 반복하면 제목이 두 번 보인다(WP-255).
      // 웹도 삽입 전에 같은 제목 H1 을 걷어내지만(wikiAiTitleHeading) 1차로 프롬프트에서 막는다.
      return notePrompt(
        `다음 주제로 노트 문서 초안을 작성해줘: ${i.prompt ?? ''}\n\n(참고 제목: ${i.pageTitle})\n\n페이지 제목은 이미 문서 위에 따로 표시되므로 본문 첫 줄에 제목을 H1(# 제목)으로 반복하지 마. 섹션은 ## 부터 시작해.`,
      );
    case 'rewrite_tone':
      // 톤(prompt)으로 재작성. 의미 유지, 변환문만 출력(시스템 프롬프트가 머리말 억제).
      return notePrompt(
        `다음 텍스트를 "${i.prompt ?? '격식체'}" 톤으로 자연스럽게 다시 써줘. 의미는 유지하고, 변환된 텍스트만 출력해.\n\n${ctx}`,
      );
    case 'translate':
      return notePrompt(
        `다음 텍스트를 ${i.prompt ?? '영어'}로 번역해줘. 번역문만 출력해.\n\n${ctx}`,
      );
    case 'expand':
      return notePrompt(
        `다음 텍스트를 더 구체적이고 풍부하게 확장해줘. 핵심 의미는 유지하고, 확장된 텍스트만 출력해.\n\n${ctx}`,
      );
    case 'condense':
      return notePrompt(
        `다음 텍스트를 핵심만 남겨 더 간결하게 줄여줘. 줄인 텍스트만 출력해.\n\n${ctx}`,
      );
    case 'polish':
      return notePrompt(
        `다음 텍스트의 맞춤법과 문장을 자연스럽게 다듬어줘. 의미는 바꾸지 말고, 다듬은 텍스트만 출력해.\n\n${ctx}`,
      );
    case 'fix_html':
      return { system: WIKI_FIX_HTML_SYSTEM_PROMPT, user: buildFixHtmlMessage(i) };
  }
}
