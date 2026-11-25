import { useSearchParams } from 'react-router-dom';

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
 * 「필터 지우기」 이동의 state — 지우기 신호만 새 값으로 싣는다(이전 state 는 모두 버린다). 신호값은 호출마다 달라야 draft 가 접힌다.
 *
 * 이전 state 에서 살릴 키는 허용 목록 방식으로 고르되 지금 살릴 키는 없다(빈 허용 목록 — 그래서 이전 state 를 인자로 받지 않는다).
 * 이후 「필터 지우기」 뒤에도 남겨야 하는 키가 생기면 이 함수가 이전 state 를 받아 허용 목록의 키만 골라 담도록 고친다.
 * 통째로 복사하지 않는 이유: 새 location.key 로 옛 표지가 다시 읽혀 되살아난다 —
 * 사이드바 고정 보기 링크의 savedViewId 는 그 보기를 다시 고르게 하고(useSavedViewState), projectTab 은 「그 이동 한 번에만」 붙는 표지다.
 * 개요 표지(fromOverview)·알 수 없는 값 지우기 표지(ignoredCleared)도 결과에 남지 않는다 —
 * 이 이동은 「필터를 지운 것」이라 useRememberedIssueQuery 가 조건 기억도 지워야 하기 때문이다(기존 의도 유지).
 */
export function withIssueFiltersReset(): object {
  return { [ISSUE_FILTERS_RESET_KEY]: ++resetSeq };
}

/** 「필터 지우기」 이동의 navigate 옵션 — replace 이동에 지우기 신호 state 를 싣는다. 호출부가 각자 조립하지 않게 모은 헬퍼. */
export function issueFiltersResetNav(): { replace: true; state: object } {
  return { replace: true, state: withIssueFiltersReset() };
}

/**
 * 필터 지우기 — view·group·정렬(WP-1238)(과 모바일 보드 탭·목록 열 구성)은 유지하고 나머지 필터 파라미터만 지운다. 빈 상태·불러오기 실패(4xx) 상태가 공유한다.
 * 검색창 draft 는 이 훅 바깥(필터 줄)에 있어, 아직 URL 에 안 쓴 대기 중 검색어가 지운 뒤 되살아나지 않게
 * router state 의 지우기 신호(issueFiltersReset)로 알린다 — 필터 줄의 useSearchDraft 가 cancelKey 로 받아 debounce 를 접는다(WP-2125).
 */
export function useResetIssueFilters(): () => void {
  const [, setParams] = useSearchParams();
  return () =>
    setParams((prev) => {
      const p = new URLSearchParams();
      const view = prev.get('view');
      const group = prev.get('group');
      if (view) p.set('view', view);
      if (group) p.set('group', group);
      return carryViewOptions(carrySort(p, prev), prev);
    }, issueFiltersResetNav());
}
