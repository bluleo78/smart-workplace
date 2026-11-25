import { useLocation, useSearchParams } from 'react-router-dom';

import { carrySort, carryViewOptions } from '../../../lib/issueFilters';

/** 「필터 지우기」 이동이 router state 에 싣는 키 — 값은 지울 때마다 달라지는 숫자(WP-2125). */
const ISSUE_FILTERS_RESET_KEY = 'issueFiltersReset';

/** location.state 에서 지우기 신호를 읽는다 — 없거나 다른 state 면 undefined. 검색 draft 의 cancelKey 로 쓴다. */
export function readIssueFiltersReset(state: unknown): number | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const v = (state as Record<string, unknown>)[ISSUE_FILTERS_RESET_KEY];
  return typeof v === 'number' ? v : undefined;
}

/** 지우기 신호용 모듈 단위 증가 카운터 — Date.now() 는 같은 ms 에 두 번 지우면 값이 같아 draft 가 접히지 않는다. */
let resetSeq = 0;

/**
 * 열림 마크 등은 살리고 지우기 신호만 새 값으로 합친다. 매번 값이 달라야 draft 가 접힌다.
 * 개요 표지(fromOverview)·알 수 없는 값 지우기 표지(ignoredCleared)는 뺀다 — 이 이동은 「필터를 지운 것」이라 조건 기억도 지워야 하는데,
 * 표지가 남으면 useRememberedIssueQuery 가 기억을 건드리지 않고 일찍 돌아가 다음 진입에 옛 필터가 복원된다.
 */
export function withIssueFiltersReset(state: unknown): object {
  const rest: Record<string, unknown> = { ...(state && typeof state === 'object' ? (state as Record<string, unknown>) : {}) };
  delete rest.fromOverview;
  delete rest.ignoredCleared;
  return { ...rest, [ISSUE_FILTERS_RESET_KEY]: ++resetSeq };
}

/** 「필터 지우기」 이동의 navigate 옵션 — replace 이동에 지우기 신호 state 를 싣는다. 호출부가 각자 조립하지 않게 모은 헬퍼. */
export function issueFiltersResetNav(state: unknown): { replace: true; state: object } {
  return { replace: true, state: withIssueFiltersReset(state) };
}

/**
 * 필터 지우기 — view·group·정렬(WP-1238)(과 모바일 보드 탭·목록 열 구성)은 유지하고 나머지 필터 파라미터만 지운다. 빈 상태·불러오기 실패(4xx) 상태가 공유한다.
 * 검색창 draft 는 이 훅 바깥(필터 줄)에 있어, 아직 URL 에 안 쓴 대기 중 검색어가 지운 뒤 되살아나지 않게
 * router state 의 지우기 신호(issueFiltersReset)로 알린다 — 필터 줄의 useSearchDraft 가 cancelKey 로 받아 debounce 를 접는다(WP-2125).
 */
export function useResetIssueFilters(): () => void {
  const [, setParams] = useSearchParams();
  const { state } = useLocation();
  return () =>
    setParams((prev) => {
      const p = new URLSearchParams();
      const view = prev.get('view');
      const group = prev.get('group');
      if (view) p.set('view', view);
      if (group) p.set('group', group);
      return carryViewOptions(carrySort(p, prev), prev);
    }, issueFiltersResetNav(state));
}
