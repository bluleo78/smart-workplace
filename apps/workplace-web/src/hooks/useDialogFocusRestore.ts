// 다이얼로그 닫힘 시 포커스 복원 — Dialog·AlertDialog 콘텐츠 래퍼가 함께 쓴다.
import { useCallback, useEffect, useInsertionEffect, useRef } from 'react';

import { isKeyboardFocused } from '@/hooks/useRestoreFocusOnExit';

export const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 이유 감싸개(DisabledReasonTooltip)가 다는 표지 속성 — 순환 import 를 피하려 훅 쪽에 두고 감싸개가 가져다 쓴다. */
export const DISABLED_REASON_WRAPPER_ATTR = 'data-disabled-reason-wrapper';

/**
 * 막힌 트리거 대신 그것을 감싼 이유 감싸개로 초점을 옮긴다 — 옮겼으면 true (WP-1856).
 * 처리 중·상한으로 트리거가 막혀 있으면(disabled 는 초점을 받지 않는다) 그냥 두면 body 로 떨어진다.
 * 키보드를 쓴 경우에만, 트리거에서 가장 가까운 이유 감싸개(표지로 식별 — 안쪽 보조 span 이 있어 깊이에 기대지 않는다)가 대신 받는다.
 * 마우스 사용자는 감싸개가 초점을 받으면 툴팁이 억지로 뜨므로 건너뛴다. reason 이 없어 tabindex -1 인 감싸개는 Tab 정지가 아니므로 제외한다.
 * 대화상자 복원(focusNearest)과 팝오버 닫힘(보드 밴드 「+」)이 같은 정책을 쓰도록 꺼내 둔다.
 */
export function focusDisabledReasonWrapper(el: HTMLElement, keyboard: boolean): boolean {
  if (!keyboard) return false;
  const wrapper = el.parentElement?.closest<HTMLElement>(`[${DISABLED_REASON_WRAPPER_ATTR}]`);
  if (!wrapper || wrapper.tabIndex < 0) return false;
  wrapper.focus();
  return document.activeElement === wrapper;
}

/** 대상 안에서 포커스가 머물 행 — 숨은 대상이면 이 안에서 대신 받을 곳을 찾는다. */
const ROW = 'li, tr, [role="row"], [role="listitem"]';

/**
 * 복원 대상 — 메뉴 항목이면 그 메뉴를 연 트리거로 바꾼다. 항목은 다이얼로그가 닫힐 무렵 메뉴와 함께 사라져 있어
 * 포커스가 body 로 빠진다. 메뉴 콘텐츠의 aria-labelledby 가 메뉴 트리거(aria-haspopup="menu")일 때만 따라가고,
 * 하위 메뉴면 바깥 메뉴의 트리거까지 오른다.
 */
function restoreTargetOf(el: HTMLElement): HTMLElement {
  let target = el;
  let menu = target.closest('[role="menu"]');
  while (menu) {
    const trigger = document.getElementById(menu.getAttribute('aria-labelledby') ?? '');
    if (!(trigger instanceof HTMLElement) || trigger.getAttribute('aria-haspopup') !== 'menu') break;
    target = trigger;
    menu = target.closest('[role="menu"]');
  }
  return target;
}

/** 지금 포커스를 가진 요소의 복원 대상 — body(포커스 없음)는 대상이 아니다. */
function currentRestoreTarget(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? restoreTargetOf(active) : null;
}

/**
 * el 로 포커스를 돌리되, 숨어서 받지 못하면(hover·키보드 포커스 때만 보이는 행 작업의 ⋯ 등) 같은 행에서 실제로
 * 포커스를 받는 첫 대상으로 돌린다 — 키보드 사용자가 자리를 잃지 않게. 행이 없으면 브라우저 기본(body)에 맡긴다.
 * keyboard: 대화상자가 열려 있던 동안 마지막 입력 수단이 키보드였는지. true 일 때만 막힌 버튼의 이유 감싸개로 초점을 옮긴다.
 */
function focusNearest(el: HTMLElement, keyboard: boolean) {
  el.focus();
  if (document.activeElement === el) return;
  if (focusDisabledReasonWrapper(el, keyboard)) return;
  for (const candidate of el.closest(ROW)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []) {
    candidate.focus();
    if (document.activeElement === candidate) return;
  }
}

/**
 * 다이얼로그가 열릴 때 포커스를 갖고 있던 요소(대개 트리거 버튼)를 기억해뒀다가 닫힐 때 그 요소로 포커스를 되돌린다 —
 * Radix 기본 동작(triggerRef.focus())은 `<DialogTrigger>` 없이 커스텀 버튼 + `open` 상태로 여는 사용처(예: EventDialog)에서
 * triggerRef 가 null 이라 무력화된다(#708).
 *
 * 캡처 시점은 useLayoutEffect(마운트 시 1회)가 아니라 onOpenAutoFocus 를 쓴다: 콘텐츠 래퍼는 부모가 `open` 여부와 무관하게
 * 항상 JSX 트리에 존재하므로(Presence 로 내부 DOM 만 열고 닫음) 래퍼의 useLayoutEffect 는 최초 마운트 시 한 번만 돈다.
 * onOpenAutoFocus 는 Radix FocusScope 가 "다이얼로그 안으로 포커스를 옮기기 직전"에 매 open 마다 동기 호출한다.
 *
 * 열 때는 포커스를 먼저 캡처한 뒤 사용처의 onOpenAutoFocus 를 실행한다(사용처가 포커스를 옮겨도 복원 대상은 유지).
 * 닫을 때는 사용처의 onCloseAutoFocus 를 먼저 실행하고, 사용처가 preventDefault() 로 포커스를 직접 처리했으면 복원을 건너뛴다.
 * shouldRestore 를 주면 복원 직전에 대상을 넘겨 물어보고, 거짓이면 돌려주지 않는다(원시 시트 래퍼 RawSheetContent 가 쓴다).
 */
export function useDialogFocusRestore(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
  shouldRestore?: (target: HTMLElement) => boolean,
) {
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  // 이번 열림의 복원 대상을 이미 잡았는지 — 닫힐 때 비운다.
  const capturedRef = useRef(false);
  // 대화상자가 열려 있는 동안의 마지막 입력 수단이 키보드인지(WP-1856). 여는 순간엔 연 요소의 :focus-visible 로 시작하고
  // (대상은 document.activeElement, 예: 메뉴 항목 — 복원 대상과 다를 수 있다), 열린 사이 keydown 이면 true, pointerdown 이면 false 로 바꾼다.
  // 마우스로 열었어도 안에서 키보드를 쓰고 Esc 로 닫으면 키보드 사용자로 본다(Esc 자체가 keydown).
  const keyboardRef = useRef(false);
  // 열려 있는 동안 입력 수단 감시를 한꺼번에 해제하는 컨트롤러 — 닫힐 때·언마운트 때 abort 한다.
  const trackingRef = useRef<AbortController | null>(null);

  // 언마운트 시 남은 감시 해제(닫힘 없이 사라지는 경우의 누수 방지).
  useEffect(() => () => trackingRef.current?.abort(), []);

  const capture = useCallback(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    // document.body 는 유효한 복원 대상이 아니다(포커스가 이미 없던 상태).
    previouslyFocusedElementRef.current = currentRestoreTarget();
    keyboardRef.current = isKeyboardFocused(document.activeElement);
    // 열린 동안 마지막 입력 수단을 추적한다 — 캡처 단계라 다이얼로그 안에서 전파를 막아도 놓치지 않는다.
    trackingRef.current?.abort();
    const controller = new AbortController();
    trackingRef.current = controller;
    const options = { capture: true, signal: controller.signal };
    document.addEventListener('keydown', () => { keyboardRef.current = true; }, options);
    document.addEventListener('pointerdown', () => { keyboardRef.current = false; }, options);
  }, []);

  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      // 사용처 콜백보다 먼저 캡처한다 — 콜백이 포커스를 다이얼로그 안으로 직접 옮기면(preventDefault + focus()) 뒤에 읽은
      // activeElement 가 다이얼로그 자신이 되어 닫을 때 트리거로 돌아가지 못한다.
      // 대개는 DialogOpenerProbe 가 이미 잡아 두었다 — 여기서는 그러지 못한 경우만 잡는다. 순수 관찰이라 defaultPrevented 와 무관.
      capture();
      onOpenAutoFocus?.(event);
    },
    [capture, onOpenAutoFocus],
  );

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = previouslyFocusedElementRef.current;
      // 래퍼가 open 사이클을 넘어 유지되므로, 다음 open 에서 stale 복원을 막기 위해 이번 close 에서 소비한 뒤 비운다.
      previouslyFocusedElementRef.current = null;
      capturedRef.current = false;
      // 닫혔으니 입력 수단 감시를 끝낸다 — keyboardRef 값은 아래 복원에서 쓴 뒤 다음 열림에서 다시 정한다.
      trackingRef.current?.abort();
      if (event.defaultPrevented) return;
      // 복원 대상이 이미 DOM 에서 제거됐을 수 있으므로 isConnected 확인 후 focus.
      if (target && target.isConnected && (shouldRestore?.(target) ?? true)) {
        event.preventDefault();
        focusNearest(target, keyboardRef.current);
      }
    },
    [onCloseAutoFocus, shouldRestore],
  );

  return { onOpenAutoFocus: handleOpenAutoFocus, onCloseAutoFocus: handleCloseAutoFocus, captureOpener: capture };
}

/**
 * 다이얼로그 콘텐츠의 첫 자식으로 둔다 — 콘텐츠가 마운트될 때 insertion 효과(DOM 변경 단계)에서 연 요소를 잡아 둔다(WP-817).
 * 콘텐츠 안 입력 칸의 autoFocus 는 그 뒤 레이아웃 단계에서 포커스를 옮기고, 그러면 Radix 는 onOpenAutoFocus 를 부르지 않는다
 * (이미 안에 포커스가 있다) — onOpenAutoFocus 에서만 잡으면 복원 대상이 없어 닫을 때 body 로 빠졌다(드라이브 새 폴더).
 * 아무것도 그리지 않는다.
 */
export function DialogOpenerProbe({ onMount }: { onMount: () => void }) {
  useInsertionEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}
