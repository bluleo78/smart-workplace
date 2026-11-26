// 누르면 사라지는 단추의 동작 뒤 포커스 복원(WP-2133) — 「되돌리기」처럼 누른 단추가 동작이 끝나며 사라지면 포커스가 body 로 떨어져
// 키보드·스크린리더 사용자의 다음 Tab 이 화면 처음부터 시작한다. 그 단추를 키보드로 눌렀을 때만, 동작이 끝나고 화면이 가라앉은 뒤 대상으로 옮긴다.
import { type MouseEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { focusLostOrDetached } from './useRestoreFocusOnExit';

/** 사라지는 단추에 펼쳐 넣는 처리 묶음. */
export interface RestoreFocusTriggerProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: () => void;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * 동작 단추를 누른 뒤 active 가 끝나고 settling 도 풀리면, 포커스가 갈 곳을 잃었을 때 getTarget() 으로 옮긴다.
 *
 * - **키보드일 때만**: 클릭 바로 앞에 그 단추의 pointerdown 이 있었으면 포인터(마우스·터치)로 보고 옮기지 않는다 —
 *   막힌 단추 감싸개 같은 대상에 초점이 가면 툴팁이 저절로 뜬다. detail·:focus-visible 로 가르지 않는 까닭: VoiceOver 의 VO+Space 는
 *   pointerdown 없이 detail=1 클릭을 보내고, Tab 으로 초점을 둔 단추를 마우스로 누르면 :focus-visible 이 남는다.
 *   keydown 은 지난 포인터 표시를 지운다(눌렀다 끌어 나간 뒤 키보드로 누를 때).
 * - **눌렀을 때만**: 표지는 triggerProps 의 클릭이 세운다 — 다른 경로로 active 가 끝나면(백그라운드 갱신 등) 돌지 않는다.
 *   동작이 실패해 단추가 남으면 clear() 로 표지를 거둔다(나중에 다른 경로로 끝날 때 도는 것을 막는다).
 * - **가라앉은 뒤**: settling(잠깐의 잠금·검사 중 등)이 참인 동안은 기다린다 — 그 사이 대상이 잠시 disabled 라 엉뚱한 곳을 고르지 않게.
 * - 눌렀던 단추가 지워져 끊긴 채 activeElement 로 남은 때도 잃은 것으로 본다(WP-2055). 사용자가 다른 곳으로 옮겼으면 빼앗지 않는다.
 */
export function useRestoreFocusAfterAction({ active, settling = false, getTarget }: {
  /** 동작이 진행 중인지(예: 편집 중·저장 중) — 참 → 거짓이 되는 때가 끝이다 */
  active: boolean;
  /** 끝난 뒤에도 기다릴 잠깐의 상태 */
  settling?: boolean;
  /** 옮길 대상 — 고르는 순간의 DOM 으로 정한다 */
  getTarget: () => HTMLElement | null | undefined;
}) {
  const pending = useRef(false);
  // 마지막으로 pointerdown 을 받은 단추 — 클릭에서 그 단추와 같으면 포인터로 누른 것이다(한 번 쓰고 비운다)
  const pointerPressed = useRef<EventTarget | null>(null);
  // 최신 getTarget — 복원 효과보다 먼저(레이아웃 효과) 갈아 끼워 그 렌더의 값으로 고른다
  const getTargetRef = useRef(getTarget);
  useLayoutEffect(() => {
    getTargetRef.current = getTarget;
  });

  useEffect(() => {
    if (!pending.current || active || settling) return;
    pending.current = false;
    if (!focusLostOrDetached()) return;
    getTargetRef.current()?.focus({ preventScroll: true });
  }, [active, settling]);

  const clear = useCallback(() => {
    pending.current = false;
  }, []);

  /** 사라지는 단추에 펼쳐 넣을 처리 — onAction 은 원래 클릭 동작. */
  const triggerProps = (onAction: () => void): RestoreFocusTriggerProps => ({
    onPointerDown: (e) => {
      pointerPressed.current = e.currentTarget;
    },
    onKeyDown: () => {
      pointerPressed.current = null;
    },
    onClick: (e) => {
      pending.current = pointerPressed.current !== e.currentTarget;
      pointerPressed.current = null;
      onAction();
    },
  });

  return { triggerProps, clear };
}
