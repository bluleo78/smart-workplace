// 목록 행의 컨트롤이 사라질 때 포커스 이어 주기(WP-832) — 이슈 코멘트를 키보드로 지우면 행이 통째로 빠지고, 채팅 메시지를 지우면
// 행이 「(삭제됨)」으로 다시 그려지며 삭제·수정 버튼이 사라져 포커스가 body 로 빠졌다. 그러면 키보드·스크린리더 사용자의 다음 Tab 이
// 화면 처음부터 시작한다(WCAG 2.4.3). 목록이 마지막에 포커스된 컨트롤과 그 행을 기억해 두고, 그것이 사라진 채 포커스가 body 면
// 지운 자리 근처로 옮긴다.
// 행 표식: 각 행의 data-message-id(채팅 메시지·이슈 코멘트 행이 길게 누르기 위임용으로 이미 단다).
import { useEffect, useRef, useState } from 'react';

const ROW_SELECTOR = '[data-message-id]';

/**
 * 포커스가 목록 밖 이 오버레이들로 옮겨 가도 기억을 지우지 않는다 — 삭제 확인창·작업 시트·메뉴·실행 취소 토스트를 거쳐 다시 돌아오거나,
 * 그 사이 행이 지워진다.
 */
const TRANSIENT_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-sonner-toaster]';

/** 마지막에 포커스된 요소와 그 행, 행의 순서. */
interface LastFocus {
  el: HTMLElement;
  row: HTMLElement | null;
  index: number;
}

function rowsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

/**
 * 포커스가 갈 곳을 잃었는지 — body, 지워진 요소(브라우저가 body 로 돌리는 처리를 다음 렌더링 단계로 미루면 커밋 직후에는
 * 지워진 요소가 activeElement 로 남는다), 또는 목록을 담은 바깥 컨테이너(이슈 채팅 드로어: Radix 대화상자는 안의 포커스된 요소가
 * 지워지면 대화상자 자체로 포커스를 옮긴다). 사용자가 다른 곳으로 옮겼으면 빼앗지 않는다.
 */
function focusLost(list: HTMLElement): boolean {
  const el = document.activeElement;
  return el === null || el === document.body || !el.isConnected || (el !== list && el.contains(list));
}

/**
 * 탭 순서에 없는 행(·보드 열 같은 컨테이너)에 포커스를 준다 — 그동안만 tabindex=-1 을 달고 떠나면 뗀다(늘 달아 두면 빈 곳 클릭이
 * 그 요소를 포커스해 키보드 단축키 판정 등 body 포커스를 전제로 한 동작이 달라진다).
 */
export function focusRow(row: HTMLElement) {
  if (!row.hasAttribute('tabindex')) {
    row.setAttribute('tabindex', '-1');
    row.addEventListener('blur', () => row.removeAttribute('tabindex'), { once: true });
  }
  row.focus({ preventScroll: true });
}

/**
 * 돌려준 ref 를 행(data-message-id)들을 담은 목록 요소에 단다. items 가 바뀌어 다시 그려진 직후, 마지막에 포커스된 컨트롤이 사라졌고
 * 포커스가 body 면:
 * - 그 행이 남아 있으면(채팅 메시지 → 「(삭제됨)」) 그 행으로,
 * - 행이 빠졌으면(코멘트 삭제) 같은 자리에 온 행(뒤 행이 당겨 온다, 마지막이었으면 바로 앞 행)으로,
 * - 남은 행이 없으면 fallback(예: 작성 입력칸)으로 옮긴다.
 * 목록 요소는 상태로 들고 있다 — 빈 목록이면 다른 화면을 그리다 첫 메시지가 오면 목록을 그리는 곳(이슈 채팅)에서도 그때 리스너를 단다
 * (ref 객체를 효과 의존성으로 두면 마운트 때 목록이 없을 경우 영영 달지 못한다).
 */
export function useListFocusRescue(items: unknown, fallback?: () => HTMLElement | null) {
  const [list, setList] = useState<HTMLElement | null>(null);
  const last = useRef<LastFocus | null>(null);

  useEffect(() => {
    if (!list) return;
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      const row = e.target.closest<HTMLElement>(ROW_SELECTOR);
      last.current = { el: e.target, row, index: row ? rowsOf(list).indexOf(row) : -1 };
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      // 목록 밖 실제 요소로 옮겨 갔으면 잊는다 — 확인창·시트·토스트 같은 오버레이는 이 행을 다루는 중이다.
      // 단, 목록 자체를 담은 오버레이(이슈 채팅 드로어)는 예외가 아니다 — 그 안의 작성칸으로 옮겨 간 것은 목록을 떠난 것이다.
      if (!(next instanceof Element) || list.contains(next)) return;
      const overlay = next.closest(TRANSIENT_OVERLAY_SELECTOR);
      if (!overlay || overlay.contains(list)) last.current = null;
    };
    list.addEventListener('focusin', onFocusIn);
    list.addEventListener('focusout', onFocusOut);
    return () => {
      list.removeEventListener('focusin', onFocusIn);
      list.removeEventListener('focusout', onFocusOut);
    };
  }, [list]);

  // 행 안의 더 좁은 복구가 먼저 돌게 일반 효과로 둔다 — 반응 컨트롤(useReactionFocusRestore, 레이아웃 효과)과 수정 종료 뒤
  // 「수정」 버튼 복귀(useRestoreFocusOnExit, 자식의 일반 효과)가 먼저 포커스를 잡으면 body 가 아니어서 여기선 손대지 않는다.
  useEffect(() => {
    const prev = last.current;
    if (!list || !prev || prev.el.isConnected || !focusLost(list)) return;
    if (prev.row?.isConnected) {
      focusRow(prev.row);
      return;
    }
    const rows = rowsOf(list);
    const row = prev.index >= 0 ? rows[Math.min(prev.index, rows.length - 1)] : undefined;
    if (row) focusRow(row);
    else fallback?.()?.focus({ preventScroll: true });
  }, [list, items, fallback]);

  return setList;
}
