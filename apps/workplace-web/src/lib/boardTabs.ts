// 모바일 보드 상태 탭(WP-195) — 선택 탭 결정과 좌우 스와이프 판정. 렌더와 분리해 단위 테스트로 고정한다.

/** 선택 탭을 담는 URL 쿼리 키 — replace 로 써서 상세 갔다 뒤로 와도·새로고침해도 같은 탭으로 복귀한다. */
export const BOARD_TAB_PARAM = 'boardTab';

export type BoardTabInfo = { status: string; count: number; pending: boolean };

// 기본 탭 우선순위 — 지금 하는 일(진행 중) → 할 일. 둘 다 비면 첫 탭.
const DEFAULT_ORDER = ['IN_PROGRESS', 'TODO'];

/**
 * 선택 탭 결정. URL 값이 보이는 탭(상태 필터로 숨겨지지 않음)이면 그대로, 아니면 기본 규칙.
 * 응답 전(pending)인 상태는 「비어 있지 않음」으로 본다 — 첫 로드에서 진행 중 응답 전에 할 일로 갔다 튀지 않게.
 */
export function resolveBoardTab(param: string | null, tabs: BoardTabInfo[]): string {
  if (param && tabs.some((t) => t.status === param)) return param;
  for (const s of DEFAULT_ORDER) {
    const t = tabs.find((x) => x.status === s);
    if (t && (t.pending || t.count > 0)) return s;
  }
  return tabs[0]?.status ?? '';
}

export type SwipeDir = 'next' | 'prev';

/** 좌우 스와이프 판정 — 수평 이동이 수직보다 크고 임계(기본 60px)를 넘을 때만. 손가락이 왼쪽으로 = 다음 탭. */
export function swipeDirection(dx: number, dy: number, threshold = 60): SwipeDir | null {
  if (Math.abs(dx) <= threshold || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}
