// 모바일 보드 상태 탭(WP-195, 프로젝트 상태별 탭 WP-808) — 선택 탭 결정과 좌우 스와이프 판정. 렌더와 분리해 단위 테스트로 고정한다.

import type { IssueStatus } from '../types/issue';

/** 선택 탭(statusId)을 담는 URL 쿼리 키 — replace 로 써서 상세 갔다 뒤로 와도·새로고침해도 같은 탭으로 복귀한다. */
export const BOARD_TAB_PARAM = 'boardTab';

/** 상태 탭 한 칸(WP-808) — 프로젝트 상태 하나. 범주는 기본 탭 규칙·예전 범주 링크 해석에 쓴다. */
export type BoardTabInfo = { statusId: number; category: IssueStatus; count: number; pending: boolean };

// 기본 탭 범주 우선순위 — 지금 하는 일(진행 중) → 할 일. 둘 다 비면 첫 탭.
const DEFAULT_ORDER: IssueStatus[] = ['IN_PROGRESS', 'TODO'];

/**
 * 선택 탭(statusId) 결정. 상태 목록 로딩 중(탭 없음)이면 null — 기본 탭을 미리 고르지 않는다.
 * 1) URL 값이 보이는 탭(상태 필터로 숨겨지지 않음)의 statusId 면 그대로.
 * 2) URL 값이 범주 코드면(상태 탭 이전 링크 `boardTab=IN_PROGRESS`) 그 범주의 첫 탭.
 * 3) 아니면 진행 중 → 할 일 범주 순으로, 범주 안 표시 순서대로 비어 있지 않거나 응답 전(pending)인 첫 상태.
 *    pending 을 「비어 있지 않음」으로 보는 건 첫 로드에서 진행 중 응답 전에 할 일로 갔다 튀지 않게.
 * 4) 다 비면 첫 탭.
 */
export function resolveBoardTab(param: string | null, tabs: BoardTabInfo[]): number | null {
  if (tabs.length === 0) return null;
  if (param) {
    const byId = /^\d+$/.test(param) ? tabs.find((t) => t.statusId === Number(param)) : undefined;
    if (byId) return byId.statusId;
    const byCategory = tabs.find((t) => t.category === param);
    if (byCategory) return byCategory.statusId;
  }
  for (const c of DEFAULT_ORDER) {
    const t = tabs.find((x) => x.category === c && (x.pending || x.count > 0));
    if (t) return t.statusId;
  }
  return tabs[0].statusId;
}

export type SwipeDir = 'next' | 'prev';

/** 좌우 스와이프 판정 — 수평 이동이 수직보다 크고 임계(기본 60px)를 넘을 때만. 손가락이 왼쪽으로 = 다음 탭. */
export function swipeDirection(dx: number, dy: number, threshold = 60): SwipeDir | null {
  if (Math.abs(dx) <= threshold || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}
