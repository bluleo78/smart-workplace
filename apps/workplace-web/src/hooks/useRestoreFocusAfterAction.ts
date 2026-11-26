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
 *   keydown 은 지난 포인터 표시를 지운다(눌렀다 끌어 나간 뒤 키보드로 누를 때). 같은 포인터를 단추 밖(좌표 기준)에서 뗐거나
 *   pointercancel·문맥 메뉴로 끝나도 지우고, 주 단추가 아닌 누름은 세우지 않는다 — 클릭이 오지 않은 채 남은 표시 때문에
 *   뒤이은 VO+Space(pointerdown·keydown 없는 detail=1 클릭)를 포인터로 잘못 보지 않게.
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
  // 이번 누름에 문서에 건 일회용 pointerup·pointercancel·contextmenu 감시의 AbortController — 다음 누름·언마운트 때 abort 해 쌓이지 않게 한다
  const pointerWatch = useRef<AbortController | null>(null);
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

  // 언마운트 때 문서에 남은 포인터 감시를 뗀다
  useEffect(() => () => pointerWatch.current?.abort(), []);

  const clear = useCallback(() => {
    pending.current = false;
  }, []);

  /** 사라지는 단추에 펼쳐 넣을 처리 — onAction 은 원래 클릭 동작. */
  const triggerProps = (onAction: () => void): RestoreFocusTriggerProps => ({
    onPointerDown: (e) => {
      // 주 단추(왼쪽·터치·펜 접촉)만 센다 — 오른쪽·가운데 누름은 click 이 오지 않아 표시가 남으면 뒤이은 VO+Space 를 포인터로 잘못 본다
      if (e.button !== 0) return;
      const button = e.currentTarget;
      // 이번 누름의 포인터 — 다른 손가락·펜 등 다른 포인터의 놓기·취소에는 반응하지 않는다
      const pointerId = e.pointerId;
      pointerPressed.current = button;
      // 이번 누름이 어디서 끝나는지 문서에서 한 번만 본다. 보통 마우스 순서는 pointerdown → pointerup(단추 위) → click 이라
      // 단추 위에서 뗀 pointerup 에는 표시를 남긴다(지우면 마우스 클릭이 키보드로 잘못 보여 툴팁이 뜬다).
      // 단추 밖에서 뗐거나(끌어 나감) 취소되거나 문맥 메뉴가 열리면(mac 의 ctrl+클릭) 클릭이 오지 않으므로 표시를 지운다.
      // 지난 누름의 감시를 걷고 이번 누름용으로 새로 건다 — abort 하나로 세 감시가 함께 떨어진다
      pointerWatch.current?.abort();
      const watch = new AbortController();
      pointerWatch.current = watch;
      // 이번 누름의 감시만 부르므로 표시를 그대로 비운다
      const forget = () => {
        pointerPressed.current = null;
        watch.abort();
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        // 놓은 자리는 좌표로 잰다 — 터치는 누른 단추가 포인터를 암시적으로 잡아 밖에서 떼도 pointerup 대상이 단추다.
        // 좌표로 못 재면(jsdom 등 elementFromPoint 없음·화면 밖) 이벤트 대상으로 대신한다.
        const at = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
        const released = at ?? ev.target;
        if (released instanceof Node && button.contains(released)) watch.abort();
        else forget();
      };
      const onCancel = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === pointerId) forget();
      };
      const options = { capture: true, signal: watch.signal };
      document.addEventListener('pointerup', onUp, options);
      document.addEventListener('pointercancel', onCancel, options);
      document.addEventListener('contextmenu', forget, options);
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
