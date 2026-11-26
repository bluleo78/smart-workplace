// 라이브 주소 쓰기 훅(WP-2148) — 필터·그룹·보기(useIssueFilterControls)와 정렬(useIssueSortParam)이 함께 쓰는 쓰기 공통 경로.
// 저장 보기 칩·「전체」는 startTransition 안에서 주소를 먼저 바꿔, 브라우저 주소는 이미 새 값인데 렌더된 searchParams(setParams 의 prev 포함)는 옛 값일 수 있다.
// 렌더 값이나 prev 위에 얹어 쓰면 보류 중인 보기 조건이 지워지므로(WP-955·WP-2141 과 같은 근거) 쓰는 순간의 브라우저 주소(liveSearchParams)를 바탕으로 build 한다.
// 다른 화면으로 이동이 보류된 동안(브라우저 pathname ≠ 렌더된 pathname)에는 쓰지 않는다 — 다른 화면 경로에 이슈 조건 키를 replace 로 쓰지 않게.
import { useCallback } from 'react';
import { type NavigateOptions, useLocation, useSearchParams } from 'react-router-dom';

import { liveSearchParams } from '../../../lib/historyParam';

/**
 * 라이브 주소 위에 build 결과를 쓰는 함수 — nav 를 안 주면 replace(조건 기억 WP-1035·뒤로 가기 규칙을 필터 변경과 같게).
 * 쓰면 true, pathname 가드가 접었으면 false 를 돌려준다(WP-2148) — 호출부가 쓰기에 딸린 부수 효과(검색 draft 비우기·지우기 신호)를 접힌 쓰기엔 내지 않게.
 */
export function useWriteLiveParams(): (
  build: (live: URLSearchParams) => URLSearchParams,
  nav?: NavigateOptions,
) => boolean {
  const [, setParams] = useSearchParams();
  const { pathname } = useLocation();
  return useCallback(
    (build, nav) => {
      if (window.location.pathname !== pathname) return false;
      setParams(build(liveSearchParams()), nav ?? { replace: true });
      return true;
    },
    [setParams, pathname],
  );
}
