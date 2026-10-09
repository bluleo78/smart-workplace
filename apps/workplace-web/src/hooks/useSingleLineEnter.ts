// 한 줄 입력란(제목 등)의 Enter 처리 공용 훅(WP-331) — 노트 제목·이슈 제목 편집·모바일 새 이슈 시트가 같은 규칙을 쓴다.
// 무엇을: Enter 는 줄바꿈을 넣지 않고 호출부 동작(저장·다음 칸 이동)을 부른다. 단, 한글 IME 조합 Enter(글자 확정)와
//        macOS Chrome 이 확정 직후 한 번 더 보내는 조합 아닌 Enter(꼬리 Enter)는 동작으로 보지 않는다.
// 왜: 첫 키(조합 Enter)만 거르면 macOS Chrome 에서 마지막 글자 확정과 동시에 저장·이동이 일어났다.
//     노트 제목(WikiEditor)에만 있던 compositionend 가드를 공용화해 세 곳에 같이 건다.
import type { CompositionEvent, KeyboardEvent } from 'react';
import { useCallback, useMemo, useRef } from 'react';

import { isImeComposing, isTrailingImeEnter } from '@/lib/imeKey';

export interface SingleLineEnter {
  /** 입력란 onCompositionEnd 에 건다 — 꼬리 Enter 판정 기준 시각을 남긴다. */
  onCompositionEnd: (e: CompositionEvent) => void;
  /**
   * 입력란 onKeyDown 에서 부른다. Enter 면 줄바꿈을 막고(true 반환), 조합·꼬리 Enter 가 아닐 때만 action 을 부른다.
   * Enter 가 아니면 아무것도 하지 않고 false — 호출부가 Esc 등 다른 키를 이어서 처리한다.
   */
  handleEnter: (e: KeyboardEvent, action: () => void) => boolean;
}

export function useSingleLineEnter(): SingleLineEnter {
  // 마지막 compositionend 시각(이벤트 timeStamp). 꼬리 Enter 를 한 번 거르면 지워 다음 Enter 는 그대로 동작한다.
  const lastCompositionEndRef = useRef(Number.NEGATIVE_INFINITY);

  const onCompositionEnd = useCallback((e: CompositionEvent) => {
    lastCompositionEndRef.current = e.timeStamp;
  }, []);

  const handleEnter = useCallback((e: KeyboardEvent, action: () => void) => {
    if (e.key !== 'Enter') return false;
    // 한 줄 값 — 어떤 Enter 든 줄바꿈은 넣지 않는다(Safari 는 확정 뒤 keyCode 229 Enter 를 보내 기본 동작이 개행을 넣는다).
    e.preventDefault();
    // 조합 중 Enter 는 글자 확정용(Safari 는 확정 뒤 keyCode 229 로 온다).
    if (isImeComposing(e.nativeEvent)) return true;
    // macOS Chrome 은 확정 직후 조합 아닌 Enter 를 한 번 더 보낸다 — 그 한 번만 무시한다.
    if (isTrailingImeEnter(e.timeStamp, lastCompositionEndRef.current)) {
      lastCompositionEndRef.current = Number.NEGATIVE_INFINITY;
      return true;
    }
    action();
    return true;
  }, []);

  return useMemo(() => ({ onCompositionEnd, handleEnter }), [onCompositionEnd, handleEnter]);
}
