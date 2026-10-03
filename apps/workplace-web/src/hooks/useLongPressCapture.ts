// 캡처형 길게 누르기 — 행·카드처럼 자식에 링크(<a>)가 있는 컨테이너용. useLongPress 는 자기 onClick 만 삼켜
// 자식 링크의 기본 이동을 못 막으므로, 여기서는 click 을 캡처 단계에서 preventDefault+stopPropagation 한다.
// onTap 을 주면(선택 모드) 짧은 탭도 전부 가로채 이동 대신 onTap 을 실행한다.
import { type MouseEvent, type PointerEvent, useEffect, useMemo, useRef } from 'react';

import { LONG_PRESS_MS, MOVE_TOLERANCE_SQ } from './useLongPress';

// Radix 같은 포털 컴포넌트의 이벤트가 React 이벤트 위임으로 버블 올라올 수 있으므로
// 현재 요소 자체의 이벤트만 처리한다(포털 내 요소는 무시).
const isOwnEvent = (e: MouseEvent) => (e.currentTarget as Node).contains(e.target as Node);

export function useLongPressCapture({ onLongPress, onTap }: { onLongPress?: () => void; onTap?: () => void }) {
  // 최신 콜백 ref — 핸들러는 한 번만 만든다(행 memo 유지).
  const latest = useRef({ onLongPress, onTap });
  useEffect(() => {
    latest.current = { onLongPress, onTap };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // 이번 누름에서 길게 누르기가 발동했는가 — 뒤따르는 click 1회 억제.
  const fired = useRef(false);

  const handlers = useMemo(() => {
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      start.current = null;
    };
    const fire = () => {
      fired.current = true;
      latest.current.onLongPress?.();
    };
    return {
      cancel,
      bind: {
        onPointerDown: (e: PointerEvent) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          // 길게 누르기 콜백이 없으면 타이머를 시작하지 않는다(선택 모드 전용은 타이머 불필요).
          if (!latest.current.onLongPress) return;
          fired.current = false;
          cancel();
          start.current = { x: e.clientX, y: e.clientY };
          timer.current = setTimeout(() => {
            timer.current = null;
            fire();
          }, LONG_PRESS_MS);
        },
        onPointerMove: (e: PointerEvent) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (dx * dx + dy * dy > MOVE_TOLERANCE_SQ) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        // 우클릭·안드로이드 길게 터치 — 네이티브 메뉴(링크 미리보기) 대신 같은 액션.
        onContextMenu: (e: MouseEvent) => {
          if (!latest.current.onLongPress) return;
          if (!isOwnEvent(e)) return;
          e.preventDefault();
          cancel();
          fire();
        },
        onClickCapture: (e: MouseEvent) => {
          if (!isOwnEvent(e)) return;
          if (fired.current) {
            fired.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          const tap = latest.current.onTap;
          if (tap) {
            e.preventDefault();
            e.stopPropagation();
            tap();
          }
        },
      },
    };
  }, []);

  useEffect(() => handlers.cancel, [handlers]);
  return onLongPress || onTap ? handlers.bind : {};
}
