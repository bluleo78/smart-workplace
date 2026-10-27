// 보드 그리드 열 트랙 규칙 — 상태 보드(BoardScroll)와 그룹 보드 스윔레인(BoardSwimlanes, WP-1021)이 같은 폭 규칙을 쓴다.
// 열은 240px 아래로 줄이지 않고(좁은 폭에서는 가로 스크롤), 넓으면 고르게 나눈다(예전 flex-1 + min-w-[240px] 과 같은 규칙).
import type { CSSProperties } from 'react';

/** 열 columnCount 개의 그리드 트랙 style. */
export const boardTrackStyle = (columnCount: number): CSSProperties => ({
  gridTemplateColumns: `repeat(${columnCount}, minmax(240px, 1fr))`,
});
