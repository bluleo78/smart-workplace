// textarea 자동 확장 훅(WP-196) — 내용 높이에 맞춰 늘린다. CSS field-sizing 은 iOS 지원이 고르지 않아 JS 로 잰다.
// 무엇을: value 가 바뀌거나 active(편집 진입·시트 열림)가 될 때 높이를 auto 로 풀었다가 내용 높이로 다시 맞춘다.
// 왜 border 보정: border-box 라 scrollHeight(패딩까지)에 위아래 테두리(offsetHeight - clientHeight)를 더해야 내부 스크롤이 생기지 않는다.
//               테두리가 없는 textarea 는 보정값이 0 이라 같은 결과다.
import { type RefObject, useLayoutEffect } from 'react';

export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  active = true,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [ref, value, active]);
}
