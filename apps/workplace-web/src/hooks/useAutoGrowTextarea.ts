// textarea 자동 확장 훅(WP-196) — 내용 높이에 맞춰 늘린다. CSS field-sizing 은 iOS 지원이 고르지 않아 JS 로 잰다.
// 무엇을: value 가 바뀌거나 active(편집 진입·시트 열림)가 될 때 높이를 auto 로 풀었다가 내용 높이로 다시 맞춘다.
//        폭이 바뀌어도(창 크기 변경·사이드바 접기) 줄 수가 달라지므로 다시 잰다(WP-315).
// 왜 border 보정: border-box 라 scrollHeight(패딩까지)에 위아래 테두리(offsetHeight - clientHeight)를 더해야 내부 스크롤이 생기지 않는다.
//               테두리가 없는 textarea 는 보정값이 0 이라 같은 결과다.
import { type RefObject, useLayoutEffect } from 'react';

/** 높이를 내용에 맞춘다 — auto 로 풀어야 줄어든 내용에서도 scrollHeight 가 작아진다. */
function fitHeight(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  active = true,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    fitHeight(el);
  }, [ref, value, active]);

  // 폭 변화 감시 — 높이를 바꾸면 관찰 콜백이 다시 불리므로 폭이 실제로 달라졌을 때만 다시 잰다(무한 반복 방지).
  // 관찰 콜백 안에서 관찰 대상 크기를 바로 바꾸면 같은 프레임에 관찰이 다시 돌아 "ResizeObserver loop" 경고가 나므로
  // 다음 프레임(requestAnimationFrame)에 잰다. 프레임 안에 여러 번 와도 한 번만 잰다.
  // 웹 폰트(Inter, font-display swap)가 첫 측정 뒤에 오면 폭은 그대로인데 줄 수가 바뀌므로 폰트 준비 뒤 한 번 더 잰다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) fitHeight(el);
    });
    let width = el.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitHeight(el));
    });
    observer.observe(el);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, active]);
}
