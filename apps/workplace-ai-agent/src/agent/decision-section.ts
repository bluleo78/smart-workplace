// WP-1376: 반복 회차 결과 맨 끝 「정해 주세요」 절 판별. run-recurring(회차 결과를 질문으로 보고할지)과 user-message(이어 처리가 받은 질문이
// 「정해 주세요」 질문인지)가 같은 규칙을 쓰도록 한 곳에 둔다 — run-recurring 이 user-message 를 가져다 쓰므로 둘 사이의 순환 가져오기를 피해 따로 뺐다.
import { RECURRING_DECISION_HEADING } from './system-prompt.js';

// 정규식 특수 문자를 글자 그대로 맞게 감싼다 — 제목 상수를 바꿔도 패턴이 깨지지 않게.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 「정해 주세요」 절 제목 줄 패턴 — `#` 1~4개 제목(앞 공백 3칸까지, 굵게·코드 꾸밈, 끝 콜론)이나 굵게만 쓴 줄(`**정해 주세요**`, 콜론은 있어도 된다).
// 모델이 제목 모양을 바꿔 써도 놓치지 않게 관대하게 받는다. 제목 낱말은 띄어쓰기로 나눠 각각 감싸고(특수 문자도 글자 그대로) 사이 공백은 있어도
// 없어도 된다(정해주세요). 테스트가 특수 문자가 든 제목으로도 확인하도록 내보낸다.
export function buildDecisionHeadingRe(heading: string): RegExp {
  const words = heading.trim().split(/\s+/).map(escapeRegExp).join('\\s*');
  return new RegExp(
    `^\\s{0,3}(?:#{1,4}\\s*[*_\`]*\\s*${words}\\s*:?\\s*[*_\`]*\\s*:?|(?:\\*\\*|__)\\s*${words}\\s*:?\\s*(?:\\*\\*|__)\\s*:?)\\s*$`,
  );
}
const DECISION_HEADING_RE = buildDecisionHeadingRe(RECURRING_DECISION_HEADING);
// 절의 경계 — 마크다운 제목 줄(# 1~6개)이나 굵게만 쓴 이름표 줄(`**제안**`, `**제안**:`). 「정해 주세요」 뒤에 이런 줄로 다른 절이 오면 그 절 내용은 항목이 아니다.
const SECTION_BOUNDARY_RE = /^\s{0,3}(?:#{1,6}(?:\s|$)|(?:\*\*|__)[^*_\n]+?(?:\*\*|__)\s*:?\s*$)/;
// 코드 울타리 줄(``` 또는 ~~~, 3개 이상) — 울타리 안 줄은 제목·경계·항목 어느 것으로도 보지 않는다.
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// 항목 줄 — 번호 목록(1. / 1)) 또는 글머리표(- * +). 프롬프트는 번호 목록을 시키지만 글머리표로 써도 질문으로 본다.
const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/;
// 항목 내용이 「없음」류면 정할 것이 없다는 뜻이라 항목으로 세지 않는다(프롬프트가 금하지만 모델이 빈 절 대신 쓸 수 있다).
const NONE_ITEM_RE = /^[\s*_`()[\].]*(?:없음|없습니다|해당\s*없음|정할\s*(?:것|항목)(?:이)?\s*없(?:음|습니다))[\s*_`()[\].]*$/;
// 내용으로 치지 않는 줄 — 빈 줄과 가로줄(---, ***, ___).
const BLANK_OR_RULE_RE = /^\s*(?:(?:[-*_]\s*){3,})?$/;

// 결과를 절로 나눈 한 조각 — 제목이 「정해 주세요」인지, 내용 줄이 있는지, 울타리 밖 항목이 있는지.
interface Section {
  decision: boolean;
  hasContent: boolean;
  hasItem: boolean;
}

// 결과가 「정해 주세요」 절로 끝나고 그 절에 항목이 하나라도 있는지 — 있으면 사용자의 답을 기다리는 질문이다.
// - 내용이 있는 마지막 절이 「정해 주세요」여야 한다. 중간의 「정해 주세요」 제목(인용한 메일 글 등) 뒤에 다른 절이 이어지면 질문이 아니다.
// - 절이 비었거나 「없음」뿐이면 질문이 아니다. 코드 울타리 안의 줄은 제목·경계·항목으로 보지 않는다(내용으로는 친다).
// - 참고용 「제안」 절은 제목이 달라 해당하지 않는다.
export function hasDecisionSection(text: string): boolean {
  let cur: Section = { decision: false, hasContent: false, hasItem: false }; // 지금 읽는 절
  // 내용이 있는 마지막 절 — 「정해 주세요」 절 자신은 제목만 있어도 후보다(비었으면 끝의 hasItem 이 거른다).
  let last: Section | null = null;
  let fence: string | null = null; // 열린 울타리 표지(``` 나 ~~~ 와 그 길이) — 같은 글자로 같거나 긴 줄이 닫는다
  for (const line of text.split('\n')) {
    const f = FENCE_RE.exec(line);
    if (fence != null) {
      cur.hasContent = true;
      last = cur;
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      cur.hasContent = true;
      last = cur;
      continue;
    }
    const decision = DECISION_HEADING_RE.test(line);
    if (decision || SECTION_BOUNDARY_RE.test(line)) {
      cur = { decision, hasContent: false, hasItem: false };
      if (decision) last = cur;
      continue;
    }
    if (BLANK_OR_RULE_RE.test(line)) continue;
    cur.hasContent = true;
    last = cur;
    const item = LIST_ITEM_RE.exec(line);
    if (item && item[1].trim() && !NONE_ITEM_RE.test(item[1])) cur.hasItem = true;
  }
  return last != null && last.decision && last.hasItem;
}
