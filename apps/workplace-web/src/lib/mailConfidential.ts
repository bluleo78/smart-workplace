// 기밀 메일(WP-2029) 순수 함수 — 서버가 제목 앞에 붙이는 머리말과 같은 문구를 웹이 알고, 칸 글자에서 떼는 규칙을 둔다.

/** 기밀 메일 제목 머리말 — 서버(ConfidentialSubject)가 붙이는 문구와 같다. 웹은 표시만 하고 제목에는 붙여 보내지 않는다. */
export const CONFIDENTIAL_PREFIX = '[기밀]';

/**
 * 제목 칸 글자에서 모든 「[기밀]」(뒤 공백 포함)을 떼고 앞뒤 공백을 다듬는다.
 * [기밀] 이 실제로 있었을 때만 공백을 다듬는다 — 없으면 사용자가 쓴 제목(연속 공백 포함)을 그대로 돌려준다.
 * 토글을 켜면 머리말이 칸 앞에 따로 보이므로, 사용자가 직접 쓴 머리말이 이중으로 보이거나 서버가 또 붙이지 않게 정리한다.
 */
export function stripConfidentialPrefix(subject: string): string {
  // 머리말이 없으면 입력을 건드리지 않는다(토글만 켰는데 제목이 바뀌는 것을 막는다)
  if (!subject.includes(CONFIDENTIAL_PREFIX)) return subject;
  return subject.split(CONFIDENTIAL_PREFIX).join('').replace(/\s{2,}/g, ' ').trim();
}
