// IME(한글 등) 조합 중 키 입력 판정 — 조합 중 Enter·Backspace·Esc 는 글자 확정·편집용이라 앱 동작(전송·이동·닫기)으로 보지 않는다.
// Safari 는 조합 확정 직후 keydown 을 isComposing=false, keyCode=229 로 보내므로 229 도 조합 신호로 본다.

/** 이 keydown 이 IME 조합에 속한 키 입력인지. 네이티브 KeyboardEvent 를 넘긴다(React 이벤트면 e.nativeEvent). 키 종류는 보지 않는다. */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
