// 종료 이슈 숨김(#876) 안내(WP-606) — 보드·목록 기본 범위는 활성 사이클 밖에서 끝난(완료·취소) 이슈를 숨긴다.
// 숨겼다는 말이 없으면 빈 「완료」 열이나 끌어 놓자마자 사라지는 카드가 「이슈가 없어졌다」로 보인다.
// 숨긴 건수는 보이지 않는다(사람 결정) — 규칙 안내와 「모두 보기」만 준다.
import type { CycleStatus, CycleSummary } from '../types/cycle';

/** 숨김 대상이 되는 종료 상태. */
export const CLOSED_ISSUE_STATUSES: ReadonlySet<string> = new Set(['DONE', 'CANCELED']);

/** 토스트·빈 열 공통 안내 문구. */
export const CLOSED_HIDDEN_NOTE = '활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다';

/**
 * 숨김이 켜진 화면이 넘기는 안내 설정 — 없으면(개인 보드·「완료 모두 보기」·상태 필터 등) 안내하지 않는다.
 * visibleCycleStatuses: 종료돼도 이 화면에 남는 사이클 상태. 보드·평면 목록은 진행 중만, 사이클 구간 목록은
 * 예정 사이클 구간도 종료 이슈를 숨기지 않아 진행 중·예정 둘 다.
 */
export interface ClosedHidingNotice {
  onShowAll: () => void;
  visibleCycleStatuses: readonly CycleStatus[];
}

/** 종료로 바꾼 이슈가 이 화면에서 숨겨지는지 — 남게 하는 사이클에 하나도 속하지 않으면 숨겨진다. */
export function hiddenAfterClose(cycles: readonly CycleSummary[], visibleCycleStatuses: readonly CycleStatus[]): boolean {
  return !cycles.some((c) => visibleCycleStatuses.includes(c.status));
}
