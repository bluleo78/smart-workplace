// caret 직전 텍스트에서 마지막 @mention 토큰을 찾는다.
// 정규식: 문장 시작 또는 공백 뒤의 @ + [\w._-]{0,20}.
// 매치 끝이 입력 끝과 일치할 때만 active mention (사용자가 아직 타이핑 중).

export interface MentionDetection {
  query: string;
  anchor: number; // textBeforeCaret 안에서 '@' 의 인덱스
}

export function detectMention(textBeforeCaret: string): MentionDetection | null {
  const match = textBeforeCaret.match(/(?:^|\s)@([\w._-]{0,20})$/);
  if (!match) return null;
  const query = match[1];
  // 매치 전체는 prefix(공백) + '@' + query — '@' 위치는 끝에서 query.length + 1 만큼 앞.
  const anchor = textBeforeCaret.length - query.length - 1;
  return { query, anchor };
}
