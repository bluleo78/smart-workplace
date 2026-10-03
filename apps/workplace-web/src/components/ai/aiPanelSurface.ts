// src/components/ai/aiPanelSurface.ts
// WP-54: "AI 표면"(사이드 패널·AI 칩과 거기서 연 포털 레이어) 판별과 페이지 영역 inert 처리 공용 유틸.
// useAiPanelAwareDialog(엔티티 다이얼로그)와 AISidePanel/AppLayout 이 같은 규칙을 공유하도록 한곳에 둔다.

/** DOM 표식 — 사이드 패널 루트·AI 칩처럼 React 트리상 패널 밖이거나 패널 자체인 AI 표면. */
export const AI_PANEL_SELECTOR = '[data-ai-panel]';

/** 앱 셸의 페이지 영역 컨테이너 표식 — 자식 중 AI 패널이 아닌 것(AppRail·main)이 inert 대상. */
export const AI_PAGE_ROOT_SELECTOR = '[data-ai-page-root]';

// 사이드 패널 React 트리 안에서 발생한 네이티브 이벤트 모음.
// 왜: 패널에서 연 Tooltip/DropdownMenu/AlertDialog 등은 body 로 포털돼 DOM 상 패널 밖이지만,
// React 합성 이벤트는 포털을 넘어 React 트리(=패널)로 전파된다. 패널 루트가 capture 단계에서 원본 이벤트를
// 기록해 두면, 포털 레이어마다 data-ai-panel 을 달지 않아도 "패널에서 온 상호작용"으로 판별된다.
// (React 는 포털 컨테이너(body)에서 먼저 디스패치하므로 document 에 붙은 Radix outside 리스너보다 앞선다.)
const panelEvents = new WeakSet<Event>();

/** AISidePanel 루트의 onPointerDownCapture/onFocusCapture 에서 호출 — 원본 이벤트를 패널 발로 기록. */
export function markAiPanelEvent(e: { nativeEvent: Event }): void {
  panelEvents.add(e.nativeEvent);
}

/** Radix outside 이벤트(CustomEvent, detail.originalEvent)가 AI 표면에서 비롯됐는지. */
export function isAiPanelInteraction(e: Event): boolean {
  const original = (e as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  if (original && panelEvents.has(original)) return true;
  return isInAiPanelDom(e.target);
}

/** 대상이 DOM 상 AI 표면 내부인지 — Element 가 아닐 수 있어(document 등) 가드한다. */
export function isInAiPanelDom(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(AI_PANEL_SELECTOR) !== null;
}

/**
 * 페이지 영역(앱 셸 컨테이너의 AI 패널 외 자식)에 inert 를 걸고, 해제 함수를 돌려준다.
 * non-modal 다이얼로그에서 Tab 이 흐린 페이지로 새거나 보조기기가 페이지를 읽는 것을 막는다.
 * 다이얼로그 포털·dim·AI 칩은 body 직속이라 대상이 아니다. 원래 inert 였던 요소는 건드리지 않는다.
 */
export function inertPageArea(): () => void {
  const root = document.querySelector(AI_PAGE_ROOT_SELECTOR);
  if (!root) return () => {};
  // AI 표면을 품은 자식(모바일 셸 → 셸 루트의 AI 시트 레이어, WP-191)은 통째로 inert 하면 AI 까지 막히므로
  // 그 안으로 내려가 AI 표면이 아닌 형제만 inert 한다. 데스크톱은 AI 패널이 root 직속이라 기존과 같다.
  const targets: HTMLElement[] = [];
  const collect = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      if (!(el instanceof HTMLElement) || el.matches(AI_PANEL_SELECTOR)) continue;
      if (el.querySelector(AI_PANEL_SELECTOR)) collect(el);
      else if (!el.inert) targets.push(el);
    }
  };
  collect(root);
  targets.forEach((el) => {
    el.inert = true;
  });
  return () =>
    targets.forEach((el) => {
      el.inert = false;
    });
}
