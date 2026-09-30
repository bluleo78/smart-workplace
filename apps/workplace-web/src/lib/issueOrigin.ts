// 이슈 상세의 "출발 화면" 계산 — 상세로 들어오기 직전에 보던 화면까지 히스토리를 몇 칸 되감을지 구한다(#885).
// 왜: 목록·보드·타임라인 등 진입점이 많아 각자 출발지를 실어 보내는 대신, 히스토리 위치(idx)별로
// "이슈 상세였는지"만 기록해 두고 상세 화면 연속 구간을 건너뛴 첫 화면을 출발 화면으로 본다.
// 되감기(navigate(-n))라 새 항목을 쌓지 않고, 필터·뷰가 담긴 URL 이 그대로 복원된다.
import { matchPath } from 'react-router-dom';

/** 히스토리 위치(idx) → 그 위치가 이슈 상세였는지. 기록된 적 없는 위치는 undefined. */
export type HistoryEntries = Record<number, boolean | undefined>;

/** 경로가 이슈 상세 풀페이지(`/projects/:key/issues/:number`)인지. */
export function isIssueDetailPath(pathname: string): boolean {
  return matchPath('/projects/:key/issues/:number', pathname) !== null;
}

/**
 * 현재 위치에서 출발 화면까지의 되감기 칸 수(항상 음수)를 돌려준다.
 * 바로 아래 위치부터 내려가며 이슈 상세 연속 구간(하위·상위·연결 이슈 이동)을 건너뛴다.
 * 출발 화면을 확정할 수 없으면 null — 직접 진입·새로고침·기록되지 않은 위치를 만난 경우로, 호출부가 기본 목적지로 보낸다.
 */
export function backDeltaToOrigin(entries: HistoryEntries, currentIdx: number): number | null {
  for (let i = currentIdx - 1; i >= 0; i--) {
    const wasDetail = entries[i];
    if (wasDetail === undefined) return null;
    if (!wasDetail) return i - currentIdx;
  }
  return null;
}
