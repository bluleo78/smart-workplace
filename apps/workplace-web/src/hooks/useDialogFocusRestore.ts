// 다이얼로그 닫힘 시 포커스 복원 — Dialog·AlertDialog 콘텐츠 래퍼가 함께 쓴다.
import { useCallback, useInsertionEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
 */
function focusNearest(el: HTMLElement) {
  el.focus();
  if (document.activeElement === el) return;
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
 */
export function useDialogFocusRestore(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  // 이번 열림의 복원 대상을 이미 잡았는지 — 닫힐 때 비운다.
  const capturedRef = useRef(false);

  const capture = useCallback(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    // document.body 는 유효한 복원 대상이 아니다(포커스가 이미 없던 상태).
    previouslyFocusedElementRef.current = currentRestoreTarget();
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
      if (event.defaultPrevented) return;
      // 복원 대상이 이미 DOM 에서 제거됐을 수 있으므로 isConnected 확인 후 focus.
      if (target && target.isConnected) {
        event.preventDefault();
        focusNearest(target);
      }
    },
    [onCloseAutoFocus],
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
