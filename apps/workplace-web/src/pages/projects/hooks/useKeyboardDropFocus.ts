// 키보드로 다른 열에 놓은 보드 카드의 포커스 잇기(WP-837) — 상태가 바뀐 카드는 새 열에 새로 그려지고 원래 열의 요소는 지워진다.
// dnd-kit 의 포커스 복원은 지워진 원래 요소를 가리켜 닿지 않아 포커스가 body 로 빠졌고, 키보드·스크린리더 사용자는 옮긴 카드에서
// 이어 조작하지 못하고 화면 처음부터 다시 Tab 해야 했다(WCAG 2.4.3).
import { useEffect, useState } from 'react';

import { focusRow } from '@/hooks/useListFocusRescue';

/** 키보드로 옮긴 카드(이슈 번호)와 놓은 열(상태). */
interface KeyboardDrop {
  number: number;
  status: string;
}

const cardSelector = (number: number) => `[data-testid="issue-card-${number}"]`;

/**
 * 돌려준 함수를 키보드 상태 드롭 때 부른다. 그 뒤 다시 그려질 때마다, 포커스가 body 로 빠져 있으면:
 * - 카드가 보이면(새 열, 또는 실패로 되돌아간 원래 열) 그 카드로,
 * - 카드가 없으면(종료 이슈 숨김 WP-606 으로 사라짐) 놓은 열로 옮긴다.
 * 사용자가 카드 밖으로 포커스를 옮기면 잊는다 — 그 뒤 카드가 사라져도 포커스를 빼앗지 않는다.
 */
export function useKeyboardDropFocus() {
  const [drop, setDrop] = useState<KeyboardDrop | null>(null);

  useEffect(() => {
    if (!drop) return;
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !e.target.matches(cardSelector(drop.number))) setDrop(null);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [drop]);

  // 의존성 없이 매 렌더 뒤 확인한다 — 낙관적 이동·서버 재조회·실패 되돌림이 각각 따로 다시 그린다.
  // 드롭 직후(낙관적 이동 전)에는 원래 카드가 아직 포커스를 쥐고 있어 손대지 않는다.
  useEffect(() => {
    if (!drop) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const card = document.querySelector<HTMLElement>(cardSelector(drop.number));
    if (card) {
      card.focus();
      return;
    }
    const column = document.querySelector<HTMLElement>(`[data-testid="board-col-${drop.status}"]`);
    if (column) focusRow(column);
  });

  return setDrop;
}
