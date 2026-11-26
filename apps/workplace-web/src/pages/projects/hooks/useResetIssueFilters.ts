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

/**
 * 대기 중 검색어 쓰기를 접는 함수 모음 — 필터 줄(useIssueFilterControls)이 자기 draft 를 접는 함수를 등록한다(WP-2125 리뷰 후속).
 * 저장 보기 칩(useSavedViewState)은 필터 줄과 다른 컴포넌트라 draft 에 닿을 길이 없고, 칩 적용·「전체」는 startTransition 안에서 주소를 바꾸므로
 * 보기 데이터 로드로 전환이 보류되는 동안 router state 신호가 아직 커밋되지 않아 대기 중 debounce 가 먼저 돌아 보기 쿼리를 덮을 수 있다.
 * 그래서 클릭 순간(transition 밖)에 이 통로로 동기 취소한다.
 */
const pendingSearchCancelers = new Set<() => void>();

/** 필터 줄이 대기 중 검색어 쓰기를 접는 함수를 등록한다 — 반환값은 등록 해제(언마운트 정리용). */
export function registerPendingSearchCancel(cancel: () => void): () => void {
  pendingSearchCancelers.add(cancel);
  return () => {
    pendingSearchCancelers.delete(cancel);
  };
}

/** 대기 중(300ms debounce)인 이슈 검색어 쓰기를 지금 접는다 — issueFiltersResetNav() 가 부른다(호출부가 따로 부르다 빠뜨리지 않게). 쓰기가 접힐 수 있는 호출부(WP-2148)는 쓰기 성공 뒤 직접 부른다. */
export function cancelPendingIssueSearchWrite(): void {
  pendingSearchCancelers.forEach((cancel) => cancel());
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

/**
 * 「필터 지우기」 이동의 navigate 옵션 — replace 이동에 지우기 신호 state 를 싣는다. 호출부가 각자 조립하지 않게 모은 헬퍼.
 * 부르는 순간 대기 중 검색어 쓰기도 동기로 접는다 — router state 신호는 커밋돼야 닿아, 그 전에 debounce 가 돌면 q 가 되살아난다.
 * 그래서 클릭 핸들러에서(startTransition 밖에서) 불러야 한다 — 전환 안에서 부르면 취소도 전환과 함께 늦게 커밋된다.
 */
export function issueFiltersResetNav(): { replace: true; state: object } {
  cancelPendingIssueSearchWrite();
  return issueFiltersResetOptions();
}

/** 부수 효과 없는 「필터 지우기」 이동 옵션(replace + 지우기 신호) — 쓰기가 접힐 수 있는 호출부가 쓰고, 검색어 취소는 쓰기 성공 뒤 cancelPendingIssueSearchWrite() 로 낸다(WP-2148). */
export function issueFiltersResetOptions(): { replace: true; state: object } {
  return { replace: true, state: withIssueFiltersReset() };
}

/**
 * 필터 지우기 — view·group·정렬(WP-1238)(과 모바일 보드 탭·목록 열 구성)은 유지하고 나머지 필터 파라미터만 지운다. 빈 상태·불러오기 실패(4xx) 상태가 공유한다.
 * 검색창 draft 는 이 훅 바깥(필터 줄)에 있어, 아직 URL 에 안 쓴 대기 중 검색어가 지운 뒤 되살아나지 않게
 * router state 의 지우기 신호(issueFiltersReset)로 알린다 — 필터 줄의 useSearchDraft 가 cancelKey 로 받아 debounce 를 접는다(WP-2125).
 */
export function useResetIssueFilters(): () => void {
  const [, setParams] = useSearchParams();
  return () => {
    // 이동 옵션을 먼저 만든다 — issueFiltersResetNav() 가 클릭 순간 대기 중 검색어 쓰기를 동기로 접는다.
    const nav = issueFiltersResetNav();
    setParams((prev) => {
      const p = new URLSearchParams();
      const view = prev.get('view');
      const group = prev.get('group');
      if (view) p.set('view', view);
      if (group) p.set('group', group);
      return carryViewOptions(carrySort(p, prev), prev);
    }, nav);
  };
}
