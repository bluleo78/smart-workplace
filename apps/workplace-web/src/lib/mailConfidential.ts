// 기밀 메일(WP-2029) 순수 함수 — 서버가 제목 앞에 붙이는 머리말과 같은 문구를 웹이 알고, 칸 글자에서 떼는 규칙을 둔다.

/** 기밀 메일 제목 머리말 — 서버(ConfidentialSubject)가 붙이는 문구와 같다. 웹은 표시만 하고 제목에는 붙여 보내지 않는다. */
export const CONFIDENTIAL_PREFIX = '[기밀]';

/** 맨 앞(앞 공백 포함)에 붙은 「[기밀]」 머리말 — 겹쳐 쓴 것까지 한 번에 잡는다. 중간·뒤의 [기밀] 은 잡지 않는다. */
const LEADING_PREFIX = /^\s*(?:\[기밀\]\s*)+/;

/**
 * 제목 칸 글자의 맨 앞 「[기밀]」 머리말(뒤 공백 포함)만 뗀다.
 * 중간에 낀 [기밀](답장 제목 「RE: [기밀] …」 등)과 나머지 글자·공백은 그대로 둔다 — 남의 제목을 바꾸지 않게.
 */
export function stripConfidentialPrefix(subject: string): string {
  return subject.replace(LEADING_PREFIX, '');
}

/** 제목 칸 앞 머리말을 그릴지 — 기밀이고 제목에 [기밀] 이 없을 때만. 서버(ConfidentialSubject)가 머리말을 붙이는 규칙과 같아 보이는 제목 = 받는 제목. */
export function showsConfidentialPrefix(confidential: boolean, subject: string): boolean {
  return confidential && !subject.includes(CONFIDENTIAL_PREFIX);
}
