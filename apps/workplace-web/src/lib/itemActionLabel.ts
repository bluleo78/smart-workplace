// 행마다 반복되는 아이콘 버튼의 접근 이름에 대상을 붙인다(WP-940).
// 「수정」「삭제」처럼 고정 이름이면 스크린리더의 버튼 목록에 같은 이름이 행 수만큼 나와 어느 항목의 버튼인지 알 수 없었다.
// WP-923 과 같은 방식 — 대상 이름을 앞에, 동작을 뒤에(예: 「「회의는 3시…」 메시지 수정」).

/** 본문 미리보기 길이 — 버튼 이름이 너무 길어지지 않게 자른다. */
const SNIPPET_MAX = 20;

/**
 * 본문을 버튼 이름용 미리보기로 — 공백·줄바꿈을 한 칸으로 줄이고 길면 잘라 「…」로 감싼다. 비면 null.
 */
export function quotedSnippet(text: string | null | undefined, max = SNIPPET_MAX): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  const chars = Array.from(flat);
  const cut = chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
  return `「${cut}」`;
}

/**
 * 「<미리보기> <종류> <동작>」 — 본문이 비면 「<종류> <동작>」.
 * @param text 항목 본문(메시지·메모리 내용 등)
 * @param kind 항목 종류(「메시지」「메모리」)
 * @param action 동작(「수정」「삭제」)
 */
export function itemActionLabel(text: string | null | undefined, kind: string, action: string): string {
  const snippet = quotedSnippet(text);
  return snippet ? `${snippet} ${kind} ${action}` : `${kind} ${action}`;
}
