// 채팅 입력 공용 키 규칙 — Enter=전송, Shift+Enter=줄바꿈, IME(한글) 조합 중 Enter 는 글자 확정용이라 무시.
// Safari 는 조합 종료 후 Enter keydown 을 보내 isComposing=false 가 되므로 keyCode 229 도 조합 신호로 본다.

/** 이 keydown 이 "전송" Enter 인지 판정한다. 네이티브 KeyboardEvent 를 넘긴다. */
export function isSubmitEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
