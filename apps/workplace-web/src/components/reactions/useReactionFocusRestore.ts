// 반응 칩·반응 추가 버튼이 눌린 뒤 사라질 때 포커스 이어 주기(WP-830) — 내 반응만 있던 칩을 취소하면 칩이, 반응 없는 코멘트의 헤더
// 「반응 추가」로 첫 반응을 달면 헤더 버튼이 칩 줄 ＋ 로 바뀌며 사라져 포커스가 body 로 빠졌다. 그러면 키보드·스크린리더 사용자의 다음
// Tab 이 화면 처음부터 시작한다(WCAG 2.4.3). 대상(메시지·코멘트) 행이 이 훅으로 마지막에 포커스된 반응 컨트롤을 기억해 두고, 그것이
// 사라진 채 포커스가 body 면 같은 행 안에서 그 자리를 대신하는 컨트롤로 옮긴다.
// 반응 컨트롤 표식: 칩은 data-reaction-control="pill", 반응 추가 버튼(코멘트 헤더·칩 줄 ＋, 채팅 「이모지 추가」)은 "add".
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

/** 반응 컨트롤 표식 속성 이름 — 칩·추가 버튼이 data-reaction-control 로 단다. */
const CONTROL_SELECTOR = '[data-reaction-control]';

type ControlKind = 'pill' | 'add';

/** 마지막에 포커스된 반응 컨트롤과, 같은 종류 안에서의 순서(칩이면 몇 번째 칩인지). */
interface LastControl {
  el: HTMLElement;
  kind: ControlKind;
  index: number;
}

/** host 안의 반응 컨트롤을 종류별로 DOM 순서대로 모은다. */
function controlsOf(host: HTMLElement, kind: ControlKind): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter(
    (el) => el.dataset.reactionControl === kind,
  );
}

/** 포커스가 갈 곳을 잃었는지(body) — 사용자가 다른 곳으로 옮겼으면 빼앗지 않는다. */
function focusLost(): boolean {
  const el = document.activeElement;
  return el === null || el === document.body;
}

/**
 * hostRef = 반응이 달린 대상 한 건의 행(채팅 메시지·이슈 코멘트). reactions 가 바뀌어 다시 그려진 직후, 마지막에 포커스된 반응 컨트롤이
 * 사라졌고 포커스가 body 면 대신할 컨트롤로 옮긴다:
 * - 칩이 사라졌으면 같은 자리의 칩(뒤 칩이 앞으로 당겨 온다, 마지막이었으면 바로 앞 칩), 칩이 하나도 없으면 반응 추가 버튼.
 * - 반응 추가 버튼이 사라졌으면(헤더 → 칩 줄 ＋) 새로 그려진 반응 추가 버튼, 없으면 첫 칩.
 * 반응 추가 팝오버로 고르는 동안 포커스는 portal(팝오버) 안에 있으므로, 행 밖 팝오버로 옮겨 가는 것은 기억을 지우지 않는다.
 */
export function useReactionFocusRestore(hostRef: RefObject<HTMLElement | null>, reactions: unknown) {
  const last = useRef<LastControl | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(CONTROL_SELECTOR) : null;
      if (!el) {
        last.current = null;
        return;
      }
      const kind = el.dataset.reactionControl === 'pill' ? 'pill' : 'add';
      last.current = { el, kind, index: controlsOf(host, kind).indexOf(el) };
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      // 다른 실제 요소로 옮겨 갔으면 잊는다 — 단, 행 안이거나 반응 추가 팝오버(portal) 안이면 아직 이 반응 조작 중이다.
      if (
        next instanceof Element &&
        !host.contains(next) &&
        !next.closest('[data-radix-popper-content-wrapper]')
      ) {
        last.current = null;
      }
    };
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    return () => {
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
    };
  }, [hostRef]);

  // 커밋 직후(그리기 전)에 옮겨 포커스가 body 에 머무는 순간이 화면에 드러나지 않게 한다.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const prev = last.current;
    if (!host || !prev || prev.el.isConnected || !focusLost()) return;
    const pills = controlsOf(host, 'pill');
    const adds = controlsOf(host, 'add');
    const next =
      prev.kind === 'pill'
        ? (pills[Math.min(prev.index, pills.length - 1)] ?? adds[0])
        : (adds[0] ?? pills[0]);
    next?.focus({ preventScroll: true });
  }, [hostRef, reactions]);
}
