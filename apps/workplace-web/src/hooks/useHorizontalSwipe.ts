// 좌우 스와이프 감지(WP-195 모바일 보드 탭 전환) — pointer 기반이라 터치·마우스(좁은 데스크톱 창) 모두 동작.
// 컨테이너에 touch-action: pan-y 를 함께 걸어야 브라우저가 수평 제스처를 가로채지(pointercancel) 않는다.
// 세로 스크롤은 브라우저가 맡아 pointercancel 이 오므로 시작점을 버린다.
import { type DragEvent, type MouseEvent, type PointerEvent, useRef } from 'react';

import { type SwipeDir, swipeDirection } from '@/lib/boardTabs';

export function useHorizontalSwipe(onSwipe: (dir: SwipeDir) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  // 스와이프로 끝난 제스처 직후의 click(마우스는 down/up 이 같은 카드면 click 발생)이 카드 링크로 이동하지 않게 한 번 막는다.
  const suppressClick = useRef(false);
  return {
    onPointerDown(e: PointerEvent) {
      suppressClick.current = false;
      start.current = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    },
    onPointerUp(e: PointerEvent) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y);
      if (!dir) return;
      suppressClick.current = true;
      onSwipe(dir);
    },
    onPointerCancel() {
      start.current = null;
    },
    // 마우스로 카드(<a>)를 끌면 브라우저 기본 링크 드래그가 시작돼 pointercancel 로 제스처가 끊긴다 — 기본 드래그를 막는다.
    // (모바일 보드는 DnD 를 쓰지 않고, dnd-kit 도 HTML5 드래그가 아니라 pointer 이벤트라 영향 없음)
    onDragStart(e: DragEvent) {
      e.preventDefault();
    },
    // 터치 스와이프 뒤에는 click 이 오지 않아 플래그가 남는다 — 키보드 활성화(Enter/Space → click)가 삼켜지지 않게 keydown 에서 푼다.
    onKeyDown() {
      suppressClick.current = false;
    },
    onClickCapture(e: MouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
