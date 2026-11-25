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

/** 지우기 신호용 모듈 단위 값 — 마지막으로 낸 신호값. */
let resetSeq = 0;

/**
 * 다음 지우기 신호값 — 지금 시각(ms)과 직전 값 + 1 중 큰 값이라 호출마다 반드시 커진다.
 * Date.now() 만 쓰면 같은 ms 에 두 번 지울 때 값이 같고, 0 부터 세는 카운터만 쓰면 새로고침·탭 복제 뒤
 * history.state 에 남은 옛 값과 첫 신호가 겹쳐 — 어느 쪽이든 cancelKey 가 바뀌지 않아 draft 가 접히지 않는다.
 */
function nextResetSeq(): number {
  resetSeq = Math.max(resetSeq + 1, Date.now());
  return resetSeq;
}

/**
 * 「필터 지우기」 이동의 state — 지우기 신호만 싣고 이전 state 는 모두 버린다.
 * 이전 state 를 복사하면 새 location.key 로 옛 표지가 다시 읽힌다 — 고정 보기 링크의 savedViewId 가 그 보기를 다시 고르고(useSavedViewState),
 * 「그 이동 한 번에만」 붙는 projectTab·개요(fromOverview)·알 수 없는 값 지우기(ignoredCleared) 표지가 남아 조건 기억이 지워지지 않는다.
 */
export function withIssueFiltersReset(): object {
  return { [ISSUE_FILTERS_RESET_KEY]: nextResetSeq() };
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
