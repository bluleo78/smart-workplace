// 시트·키보드 동시 표시 금지(WP-196 키보드 원칙 ③)를 위한 포커스 왕복 — 칩을 누르는 순간 입력칸을 기억하고 blur 해 키보드를 내린 뒤,
// 시트가 닫히면(선택·취소) 그 칸에 다시 포커스한다. restore 는 클릭 핸들러 안에서 동기로 불러야 iOS 가 키보드를 다시 올린다.
import { useCallback, useMemo, useRef } from 'react';

// 키보드를 올리는 입력 요소인지 — 버튼·체크박스 등은 기억할 필요가 없다. 키보드 열림 판정(useVisualViewport)과 같은 기준.
import { isKeyboardEditable } from '@/components/mobile/useVisualViewport';

export type FocusReturn = { capture: () => void; restore: () => void; discard: () => void };

export function useFocusReturn(): FocusReturn {
  const saved = useRef<HTMLElement | null>(null);
  // 현재 포커스가 입력칸이면 기억하고 blur(키보드 내림). 입력칸이 아니면 기억을 비운다.
  const capture = useCallback(() => {
    const el = document.activeElement;
    saved.current = isKeyboardEditable(el) ? el : null;
    saved.current?.blur();
  }, []);
  // 기억한 칸에 동기 포커스 후 비운다 — 그 사이 DOM 에서 빠졌으면(시트 닫힘 등) 아무것도 하지 않는다.
  const restore = useCallback(() => {
    const el = saved.current;
    saved.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, []);
  // 복귀 없이 버린다 — 시트 다음에 다른 입력칸(상위 번호)으로 포커스를 옮길 때.
  const discard = useCallback(() => {
    saved.current = null;
  }, []);
  return useMemo(() => ({ capture, restore, discard }), [capture, restore, discard]);
}
