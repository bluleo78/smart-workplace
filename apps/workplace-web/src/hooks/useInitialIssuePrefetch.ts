// 인증 뒤 첫 주소가 이슈 상세면 상세 데이터를 미리 요청한다(WP-2074).
// 상세 페이지 청크를 받은 뒤에야 useIssue 가 요청을 내던 직렬 구간을, 청크 받기와 나란히 돌려 첫 화면을 앞당긴다.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { matchIssueDetailPath } from '@/lib/issueDetailPath';

import { issueDetailQuery } from './queries/useIssue';

// 문서당 한 번만 — 어느 주소에서든 AppLayout 이 처음 마운트될 때(위키 공유 입구의 셸 포함) 쓰고 끝낸다.
// 셸이 다시 마운트돼도, 이후 앱 안 이동에서도 다시 요청하지 않는다 — 첫 진입(새로고침·링크 열기)만을 위한 것이다.
let done = false;

/** 테스트 전용 — 문서당 한 번 플래그를 되돌린다. */
export function resetInitialIssuePrefetchForTest(): void {
  done = false;
}

export function useInitialIssuePrefetch(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (done) return;
    done = true;
    const target = matchIssueDetailPath(window.location.pathname);
    if (!target) return;
    const query = issueDetailQuery(target.projectKey, target.number);
    // 재시도는 앱 전역 정책(shouldRetryQuery — 5xx·네트워크 1회) 그대로 둔다 — 청크가 먼저 와 페이지의 useIssue 가 이 진행 중 요청에 붙으면
    // 이 요청의 재시도 설정을 따르므로, 여기서 재시도를 끄면 일시 5xx 에 페이지가 재시도 없이 오류 화면을 낸다.
    void queryClient.prefetchQuery(query).then(() => {
      // 아무도 보기 전에 실패로 끝났으면 실패 캐시를 지운다 — 남겨 두면 나중에 마운트한 페이지가 오류 상태로 시작해
      // 오류 화면을 먼저 비춘 뒤 다시 요청한다. 지우면 페이지가 로딩부터 새로 요청하고 오류 처리는 페이지 한 곳에 남는다.
      // 그래서 없는·권한 없는 이슈(404·403)는 상세 요청이 두 번 나간다 — 오류 처리를 페이지 한 곳에 두려고 감수한다.
      const cached = queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true });
      if (cached?.state.status === 'error' && cached.getObserversCount() === 0) {
        queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    });
  }, [queryClient]);
}
