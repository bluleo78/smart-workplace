// 인라인 편집·선택이 끝난 뒤 포커스 복귀(WP-813) — 편집칸이 사라지거나 컨트롤이 잠시 비활성화되면 포커스가 body 로 빠져
// 키보드·스크린리더 사용자의 다음 Tab 이 화면 처음부터 시작했다. 끝나는 순간 포커스가 갈 곳을 잃었으면(body) 지정한 요소로 돌린다.
import { type RefObject, useEffect, useRef } from 'react';

/** 포커스가 갈 곳을 잃었는지 — 사용자가 다른 곳을 눌러 끝냈으면 그 자리를 빼앗지 않는다. */
function focusLost(): boolean {
  const el = document.activeElement;
  return el === null || el === document.body;
}

/**
 * active 가 true → false 로 바뀐 직후, 포커스가 body 로 빠져 있으면 target 으로 돌린다.
 * 예: 편집 중(true) → 저장·취소(false) 뒤 「편집」 버튼으로. target 은 그 시점에 그려져 있어야 한다(효과는 커밋 뒤에 돈다).
 * target 이 곧바로 disabled 가 되면 브라우저가 포커스를 다시 빼므로, 저장 중 잠그는 버튼은 aria-disabled 로 잠근다.
 */
export function useRestoreFocusOnExit(active: boolean, target: RefObject<HTMLElement | null>) {
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && focusLost()) target.current?.focus({ preventScroll: true });
    wasActive.current = active;
  }, [active, target]);
}

/**
 * 값을 고른 뒤 컨트롤이 저장 중(disabled)으로 잠겼다 풀리면 포커스를 되돌린다 — 비활성화된 트리거에서 포커스가 body 로 빠진다.
 * markPicked 는 사용자가 값을 고를 때 부른다. 고른 적 없이 disabled 가 풀리는 경우(첫 로딩·권한)는 포커스를 건드리지 않는다.
 */
export function useRestoreFocusAfterPick(disabled: boolean, target: RefObject<HTMLElement | null>) {
  const picked = useRef(false);
  const wasDisabled = useRef(disabled);
  useEffect(() => {
    if (wasDisabled.current && !disabled && picked.current) {
      picked.current = false;
      if (focusLost()) target.current?.focus({ preventScroll: true });
    }
    wasDisabled.current = disabled;
  }, [disabled, target]);
  return () => {
    picked.current = true;
  };
}
