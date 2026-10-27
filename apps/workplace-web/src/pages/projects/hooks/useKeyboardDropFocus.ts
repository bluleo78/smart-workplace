// 키보드로 다른 열에 놓은 보드 카드의 포커스 잇기(WP-837) — 상태가 바뀐 카드는 새 열에 새로 그려지고 원래 열의 요소는 지워진다.
// dnd-kit 의 포커스 복원은 지워진 원래 요소를 가리켜 닿지 않아 포커스가 body 로 빠졌고, 키보드·스크린리더 사용자는 옮긴 카드에서
// 이어 조작하지 못하고 화면 처음부터 다시 Tab 해야 했다(WCAG 2.4.3).
import { useEffect, useState } from 'react';

import { focusRow } from '@/hooks/useListFocusRescue';

/**
 * 키보드로 옮긴 카드(이슈 번호)와 놓은 열 — column 은 열 testid 의 키(프로젝트 상태 보드는 상태 id → board-col-<id>, WP-808).
 * 그룹 보드 스윔레인 칸(WP-1021)은 testid 가 board-col- 꼴이 아니라 cellTestId 로 칸 testid 전체를, laneTestId 로 그 레인을 준다.
 */
export type KeyboardDrop = { number: number } & ({ column: string | number } | { cellTestId: string; laneTestId: string });

const cardSelector = (number: number) => `[data-testid="issue-card-${number}"]`;
const columnSelector = (drop: KeyboardDrop) =>
  `[data-testid="${'cellTestId' in drop ? drop.cellTestId : `board-col-${drop.column}`}"]`;
// 카드를 찾는 범위 — 스윔레인은 그 레인 안(다중 담당자 이슈는 레인마다 같은 카드가 있다), 상태 보드는 문서 전체.
const cardScope = (drop: KeyboardDrop): ParentNode | null =>
  'laneTestId' in drop ? document.querySelector(`[data-testid="${drop.laneTestId}"]`) : document;

/**
 * 돌려준 함수를 키보드 상태 드롭 때 부른다. 그 뒤 다시 그려질 때마다, 포커스가 빠져 있거나 놓은 열에 맡겨 둔 상태면:
 * - 카드가 보이면(새 열, 또는 실패로 되돌아간 원래 열) 그 카드로,
 * - 카드가 없으면 놓은 열로 옮긴다 — 종료 이슈 숨김(WP-606)으로 사라졌거나, 드롭 뒤 재조회에서 원래 열 응답이 새 열 응답보다
 *   먼저 와 잠깐 어느 열에도 없는 때다. 뒤의 경우 카드가 다시 나타나면 열에서 카드로 옮긴다.
 * 카드는 놓은 열 안의 것을 먼저, 없으면(실패로 되돌아감) 같은 레인 안에서 찾는다 — 다중 담당자 이슈는 스윔레인 여러 곳에 같은 카드가
 * 있어(WP-1021) 문서 첫 사본이 다른 레인일 수 있다.
 * 사용자가 카드·열 밖으로 포커스를 옮기면 잊는다 — 그 뒤 카드가 사라져도 포커스를 빼앗지 않는다.
 */
export function useKeyboardDropFocus() {
  const [drop, setDrop] = useState<KeyboardDrop | null>(null);

  useEffect(() => {
    if (!drop) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof Element && (t.matches(cardSelector(drop.number)) || t.matches(columnSelector(drop)))) return;
      setDrop(null);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [drop]);

  // 의존성 없이 매 렌더 뒤 확인한다 — 낙관적 이동·서버 재조회·실패 되돌림이 각각 따로 다시 그린다.
  // 드롭 직후(낙관적 이동 전)에는 원래 카드가 아직 포커스를 쥐고 있어 손대지 않는다.
  // 지워진 요소가 아직 activeElement 로 남아 있어도 잃은 것으로 본다 — 브라우저는 포커스를 body 로 돌리는 처리를 다음 렌더링
  // 단계로 미루기도 해, 커밋 직후 효과에서는 지워진 원래 카드가 보인다.
  useEffect(() => {
    if (!drop) return;
    const active = document.activeElement;
    const column = document.querySelector<HTMLElement>(columnSelector(drop));
    const lost = active === null || active === document.body || !active.isConnected;
    if (!lost && active !== column) return;
    const card =
      column?.querySelector<HTMLElement>(cardSelector(drop.number)) ??
      cardScope(drop)?.querySelector<HTMLElement>(cardSelector(drop.number));
    if (card) card.focus();
    else if (column && active !== column) focusRow(column);
  });

  return setDrop;
}
