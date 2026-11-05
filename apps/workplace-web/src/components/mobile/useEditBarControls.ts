// 모바일 하단 편집 바 컨트롤 전달 훅(WP-196) — 제목(InlineEditableTitle)·본문(InlineEditableBody) 편집기가 공유한다.
// 무엇을: 편집 중일 때만 저장·취소 컨트롤을 onEditingChange 로 올리고, 지우기(null)는 "편집 중이던 실행"의 cleanup 에서만 한다.
// 왜: 편집 중이 아닌 분기에서 null 을 보내면 다른 편집기의 effect 가 deps(disabled) 변화로 재실행될 때 그쪽 바를 지워버린다.
//     save·cancel 은 ref 로 최신 클로저(최신 draft)를 부르고 deps 에 넣지 않는다 — 매 렌더 새 함수면 부모 setState 와 맞물려
//     cleanup(null)→재전송이 반복된다.
import { useEffect, useRef } from 'react';

import type { EditBarControls } from './MobileEditBar';

export function useEditBarControls(
  editing: boolean,
  { save, cancel, disabled }: { save: () => unknown; cancel: () => void; disabled: boolean },
  onEditingChange?: (controls: EditBarControls | null) => void,
): void {
  // 최신 save/cancel 동기화 — 렌더 중 ref 쓰기는 금지(react-hooks/refs)라 effect 에서. 아래 전송 effect 보다 먼저 선언한다.
  const saveRef = useRef(save);
  const cancelRef = useRef(cancel);
  useEffect(() => {
    saveRef.current = save;
    cancelRef.current = cancel;
  });
  useEffect(() => {
    if (!onEditingChange || !editing) return;
    onEditingChange({ save: () => void saveRef.current(), cancel: () => cancelRef.current(), disabled });
    return () => onEditingChange(null);
  }, [editing, disabled, onEditingChange]);
}
