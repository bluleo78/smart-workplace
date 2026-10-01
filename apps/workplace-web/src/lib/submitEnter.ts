// 채팅 입력 공용 키 규칙 — Enter=전송, Shift+Enter=줄바꿈, IME(한글) 조합 중 Enter 는 글자 확정용이라 무시.
// Safari 는 조합 종료 후 Enter keydown 을 보내 isComposing=false 가 되므로 keyCode 229 도 조합 신호로 본다.
// 모바일 터치 셸(lg 미만 + coarse 포인터)에선 Enter 를 전송으로 보지 않는다(M4) — 가상 키보드엔 Shift+Enter 가 없어
// 여러 줄을 쓸 방법이 사라지고, 줄을 바꾸려다 반쯤 쓴 글이 전송되기 쉽다. 전송은 보내기 버튼만. 판정은 키 입력 시점에 한다.
import { getIsTouchShell } from '@/lib/mobile/touchShell';

/** 이 keydown 이 "전송" Enter 인지 판정한다. 네이티브 KeyboardEvent 를 넘긴다. */
export function isSubmitEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !getIsTouchShell()
  );
}
