// 한 줄 값(제목 등) 정규화 — 붙여넣기·API·MCP 로 들어온 개행(CRLF·CR·LF)을 공백 하나로 바꾼다(WP-315).
// 제목에 개행이 남으면 트리·탭·검색 표시가 깨지므로 입력·표시 양쪽에서 같은 규칙을 쓴다.

/** 개행을 공백 하나로 바꾼 한 줄 문자열. CRLF 는 공백 하나가 된다. */
export function toSingleLine(text: string): string {
  return text.replace(/\r\n|[\r\n]/g, ' ');
}

/**
 * 입력란 값의 개행을 공백으로 바꾸고(있을 때만) 커서를 같은 글자 뒤에 둔다 — onChange 에서 부른다. 정규화된 값을 돌려준다.
 * DOM 값을 먼저 고쳐 두면 React 가 값을 다시 쓰지 않아 커서가 끝으로 튀지 않는다. 개행이 없으면 DOM 을 건드리지 않는다.
 */
export function normalizeSingleLineInput(el: HTMLTextAreaElement): string {
  const value = el.value;
  if (!/[\r\n]/.test(value)) return value;
  const caret = toSingleLine(value.slice(0, el.selectionStart)).length;
  const next = toSingleLine(value);
  el.value = next;
  el.setSelectionRange(caret, caret);
  return next;
}
